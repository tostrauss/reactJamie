#!/usr/bin/env bash
# Zertifikat und Profil für den iOS-Build bei GitHub (.github/workflows/ios-build.yml).
# Läuft in Git Bash unter Windows und im Terminal am Mac, vom Projektordner aus.
# Die Klicks bei Apple dazwischen stehen in store/IOS-BUILD-GITHUB.md, Schritt C.
#
#   bash ios/github-zertifikat.sh anfrage
#        privater Schlüssel + Zertifikatsanfrage (.certSigningRequest) für Apple
#   bash ios/github-zertifikat.sh p12 ~/Downloads/distribution.cer
#        macht aus Apples Zertifikat eine .p12 mit Zufallspasswort
#   bash ios/github-zertifikat.sh profil ~/Downloads/<Profil>.mobileprovision
#        bereitet das App-Store-Profil vor
#
# Alles landet in ~/jamie-ios-signing, NICHT im Repo (das Repo ist öffentlich).
# Die *.txt-Dateien dort sind die Werte der GitHub-Secrets (Inhalt kopieren).
# Den Ordner aufheben: Ohne distribution.key ist das Zertifikat nutzlos.
set -euo pipefail

# Zeigt OPENSSL_CONF auf eine Datei, die es nicht gibt (unter Windows setzt das
# z. B. der PostgreSQL-ODBC-Treiber), bricht openssl ab. Dann die Standardwerte nehmen.
if [ -n "${OPENSSL_CONF:-}" ] && [ ! -f "$OPENSSL_CONF" ]; then unset OPENSSL_CONF; fi

DIR="${JAMIE_SIGNING_DIR:-$HOME/jamie-ios-signing}"
mkdir -p "$DIR"
chmod 700 "$DIR" 2>/dev/null || true

b64 () { openssl base64 -A -in "$1"; }   # eine Zeile, gleich unter Windows und macOS

case "${1:-}" in
  anfrage)
    if [ -f "$DIR/distribution.key" ]; then
      echo "Es gibt schon einen Schlüssel: $DIR/distribution.key"
      echo "Nicht überschreiben, sonst passt das Zertifikat von Apple nicht mehr dazu."
      exit 1
    fi
    # Name über eine Konfigdatei statt -subj "/CN=…": Git Bash würde den
    # Schrägstrich am Anfang in einen Windows-Pfad umbauen.
    cat > "$DIR/anfrage.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn
[dn]
CN = JAMIE GitHub Build
C = AT
EOF
    openssl genrsa -out "$DIR/distribution.key" 2048
    openssl req -new -key "$DIR/distribution.key" -config "$DIR/anfrage.cnf" \
      -out "$DIR/distribution.certSigningRequest"
    echo ""
    echo "Fertig. Diese Datei bei Apple hochladen (Schritt C.2):"
    echo "  $DIR/distribution.certSigningRequest"
    ;;

  p12)
    CER="${2:?Pfad zur distribution.cer angeben, z. B. ~/Downloads/distribution.cer}"
    [ -f "$DIR/distribution.key" ] || { echo "Kein Schlüssel in $DIR. Erst: bash ios/github-zertifikat.sh anfrage"; exit 1; }
    openssl x509 -inform DER -in "$CER" -out "$DIR/distribution.pem"
    if [ "$(openssl x509 -noout -modulus -in "$DIR/distribution.pem" | openssl sha256)" != \
         "$(openssl rsa -noout -modulus -in "$DIR/distribution.key" | openssl sha256)" ]; then
      echo "Das Zertifikat passt nicht zu $DIR/distribution.key (mit einer anderen Anfrage erstellt?)."
      exit 1
    fi
    PASS=$(openssl rand -hex 16)
    # 3DES/SHA1 statt der OpenSSL-3-Standardwerte: macOS (security import) liest sonst die .p12 nicht.
    openssl pkcs12 -export -inkey "$DIR/distribution.key" -in "$DIR/distribution.pem" \
      -name "JAMIE GitHub Build" -out "$DIR/distribution.p12" -passout "pass:$PASS" \
      -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
    b64 "$DIR/distribution.p12" > "$DIR/IOS_DIST_P12_BASE64.txt"
    printf '%s' "$PASS" > "$DIR/IOS_DIST_P12_PASSWORD.txt"
    echo ""
    openssl x509 -noout -subject -enddate -in "$DIR/distribution.pem"
    echo "Fertig. Zwei GitHub-Secrets (Name = Dateiname ohne .txt):"
    echo "  $DIR/IOS_DIST_P12_BASE64.txt"
    echo "  $DIR/IOS_DIST_P12_PASSWORD.txt"
    ;;

  profil)
    PROF="${2:?Pfad zur .mobileprovision angeben}"
    grep -aq "com.jamie-app.app" "$PROF" || { echo "Das Profil ist nicht für com.jamie-app.app."; exit 1; }
    b64 "$PROF" > "$DIR/IOS_APPSTORE_PROFILE_BASE64.txt"
    echo "Fertig. GitHub-Secret (Name = Dateiname ohne .txt):"
    echo "  $DIR/IOS_APPSTORE_PROFILE_BASE64.txt"
    ;;

  *)
    sed -n '2,15p' "$0"
    exit 1
    ;;
esac

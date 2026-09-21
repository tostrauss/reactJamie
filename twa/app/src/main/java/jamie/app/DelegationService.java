package jamie.app;

import com.google.androidbrowserhelper.playbilling.digitalgoods.DigitalGoodsRequestHandler;

/**
 * Play Billing (2026-09-21): registering the DigitalGoodsRequestHandler is what
 * makes Chrome expose `window.getDigitalGoodsService('https://play.google.com/
 * billing')` + PaymentRequest inside this TWA. Mirrors what Bubblewrap emits
 * for `features.playBilling.enabled = true`; kept by hand because we do NOT
 * run `bubblewrap update` on this project (it would reset targetSdk to 35 —
 * see RUNBOOK.md §3). Requires the `androidbrowserhelper:billing` dependency
 * in app/build.gradle and the PaymentActivity/PaymentService entries in
 * AndroidManifest.xml.
 */
public class DelegationService extends
        com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();

        registerExtraCommandHandler(new DigitalGoodsRequestHandler(getApplicationContext()));
    }
}

// Computes a whole-number age from a date-of-birth string ("YYYY-MM-DD" or an
// ISO timestamp). Returns null for invalid / missing input.
//
// Used by the few sites that read `user.date_of_birth` directly from
// AuthContext (own profile, settings header). The backend computes age via
// EXTRACT(...) for every OTHER user so we never leak third-party DOBs to the
// client; this helper only runs against the signed-in user's own DOB.
export function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const beforeBirthday =
    now.getMonth() < d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

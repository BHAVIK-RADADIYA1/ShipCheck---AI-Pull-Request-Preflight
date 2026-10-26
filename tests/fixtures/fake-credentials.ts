// Credential-shaped fixtures are assembled at runtime so source scanners
// (including ShipCheck itself) do not read them as leaked credentials.
export const FAKE_AWS_KEY = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
export const FAKE_GITHUB_TOKEN = ["ghp", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
export const FAKE_GENERIC_SECRET = ["Zx8Kp2Qw", "9Lm4Nv7R"].join("");
export const FAKE_JWT = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
].join(".");
export const FAKE_PRIVATE_KEY_HEADER = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");

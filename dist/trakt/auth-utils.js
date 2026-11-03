import crypto from 'node:crypto';
export function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}
export function generateCodeChallenge(verifier) {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash.toString('base64url');
}

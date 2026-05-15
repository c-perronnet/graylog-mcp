// Graylog Basic auth: API token is the username; password is the literal string "token".
// Verified against src/query.js:107-110 (existing pattern in the codebase).

export function buildAuth(apiToken) {
    return {
        username: apiToken,
        password: "token",
    };
}

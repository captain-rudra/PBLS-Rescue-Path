import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { TOKEN_AUDIENCE, ADMIN_TOKEN_TTL, PARTICIPANT_TOKEN_TTL, BCRYPT_SALT_ROUNDS } from "../../../shared/constants.js";

// Two completely separate token systems (CLAUDE.md "Auth model") signed
// with the same secret but never interchangeable, because every guard
// checks `aud` first — a participant token carries aud:"play", an admin
// token carries aud:"admin", and neither payload shape satisfies the
// other's route guard even if somehow presented there.
const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not set");
  return value;
};

export const signAdminToken = ({ adminId, role }) =>
  jwt.sign({ sub: String(adminId), aud: TOKEN_AUDIENCE.ADMIN, role }, secret(), { expiresIn: ADMIN_TOKEN_TTL });

// `jti` is minted by the caller (not here) because the caller is the one
// who must also persist it as the participant's `activeJti` in the same
// operation that issues the token — a login that signed a token but failed
// to save the matching jti would issue a token the very next request could
// never satisfy.
export const signParticipantToken = ({ participantId, sessionId, jti }) =>
  jwt.sign({ sub: String(participantId), aud: TOKEN_AUDIENCE.PLAY, sessionId: sessionId ? String(sessionId) : null, jti }, secret(), {
    expiresIn: PARTICIPANT_TOKEN_TTL
  });

/** Throws (jsonwebtoken's own errors: TokenExpiredError, JsonWebTokenError) on a bad/expired/malformed token. Callers check `aud` FIRST on the result. */
export const verifyToken = token => jwt.verify(token, secret());

export const newJti = () => crypto.randomUUID();

export const hashSecret = plain => bcrypt.hash(plain, BCRYPT_SALT_ROUNDS);
export const compareSecret = (plain, hash) => bcrypt.compare(plain, hash);

const BEARER_PREFIX = "Bearer ";

/** Pulls the raw token out of `Authorization: Bearer <token>`, or null if absent/malformed. */
export const extractBearerToken = request => {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
};

export const isPinFormat = value => typeof value === "string" && /^\d{4}$/.test(value);

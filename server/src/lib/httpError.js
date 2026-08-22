export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const sendError = (response, status, code, message) => {
  response.status(status).json({ error: { code, message } });
};

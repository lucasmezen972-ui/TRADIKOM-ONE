export class AiEmployeeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AiEmployeeError";
  }
}

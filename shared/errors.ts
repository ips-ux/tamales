// An error with a message that is safe to show to the customer or the owner.
// The shared rules throw it. The Worker answers 400 with the message.

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderError";
  }
}

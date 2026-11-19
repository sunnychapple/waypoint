// The parts of a Queues batch the consumers use. MessageBatch<unknown> satisfies this type.
export type QueueMessage = {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type QueueBatch = { readonly queue: string; readonly messages: readonly QueueMessage[] };

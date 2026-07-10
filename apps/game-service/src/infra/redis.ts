import { createClient, type RedisClientType } from "redis";

export async function createRedis(url: string): Promise<RedisClientType> {
  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000),
    },
  });
  client.on("error", () => undefined);
  await client.connect();
  return client;
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class McpToolClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly clientName: string,
  ) {}

  private async connectedClient(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(this.url), {
        requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
      });
      const client = new Client({ name: this.clientName, version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport, { timeout: this.timeoutMs });
      this.client = client;
      return client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const client = await this.connectedClient();
      return await client.callTool({ name, arguments: args }, undefined, { timeout: this.timeoutMs });
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (client) await client.close().catch(() => undefined);
  }
}

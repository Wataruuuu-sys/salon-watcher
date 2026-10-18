import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export interface SecretStore {
  get(name: string): Promise<string>;
  put(name: string, value: string): Promise<void>;
}

/** SSM Parameter Store backed secrets (SecureString). The client can be injected for fakes. */
export function ssmSecretStore(prefix = '/salon-watcher/', client: SSMClient = new SSMClient({})): SecretStore {
  return {
    async get(name) {
      const res = await client.send(new GetParameterCommand({ Name: prefix + name, WithDecryption: true }));
      const value = res.Parameter?.Value;
      if (value === undefined) throw new Error(`secret not found: ${prefix + name}`);
      return value;
    },
    async put(name, value) {
      await client.send(
        new PutParameterCommand({ Name: prefix + name, Value: value, Type: 'SecureString', Overwrite: true }),
      );
    },
  };
}

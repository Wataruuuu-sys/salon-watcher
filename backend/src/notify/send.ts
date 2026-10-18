import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export type SendMail = (subject: string, body: string) => Promise<void>;

/** SES v2 sender; the client is injectable for testing. */
export function sesSender(
  from: string,
  to: string[],
  client: Pick<SESv2Client, 'send'> = new SESv2Client({}),
): SendMail {
  return async (subject, body) => {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: to },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: body, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  };
}

# sc-payload-ses

AWS SES (Simple Email Service) email adapter for [Payload CMS](https://payloadcms.com).

Uses the AWS SDK v3 `SendRawEmail` API directly — no Nodemailer dependency required. Lightweight and ideal for serverless deployments (Vercel, Lambda, etc.).

## Installation

```bash
npm install sc-payload-ses @aws-sdk/client-ses
```

## Usage

```ts
import { buildConfig } from 'payload'
import { sesAdapter } from 'sc-payload-ses'

export default buildConfig({
  email: sesAdapter({
    defaultFromAddress: 'hello@schematical.com',
    defaultFromName: 'Schematical',
    sesClientConfig: {
      region: 'us-east-1',
      // credentials are optional — uses default AWS credential chain
      // (env vars AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, IAM roles, ~/.aws/credentials)
    },
  }),
})
```

## Configuration Options

| Option | Required | Description |
|--------|----------|-------------|
| `defaultFromAddress` | Yes | Default sender email address |
| `defaultFromName` | Yes | Default sender name |
| `sesClientConfig` | No | AWS SES client config (region, credentials, endpoint, etc.) |
| `configurationSetName` | No | SES Configuration Set for tracking/events |
| `overrideRecipientAddress` | No | Override all recipients (useful for testing) |

## AWS Credentials

The adapter uses the standard AWS SDK v3 credential provider chain. In order of precedence:

1. Explicit credentials in `sesClientConfig.credentials`
2. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
3. Shared credentials file (`~/.aws/credentials`)
4. EC2/ECS/Lambda IAM role (instance metadata)

## SES Requirements

- Your sending domain or email address must be verified in SES
- If your account is in the SES sandbox, you can only send to verified addresses
- Request production access from AWS to send to any address

## Features

- Direct AWS SDK v3 integration (no Nodemailer overhead)
- Supports HTML and plain text emails
- Supports file attachments (Buffer, string content, local files, and remote URLs)
- Supports CC, BCC, Reply-To
- UTF-8 subject encoding
- SES Configuration Set support for delivery tracking
- Recipient override for testing environments

## License

MIT

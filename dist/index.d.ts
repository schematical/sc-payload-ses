import type { EmailAdapter } from 'payload';
import { type SESClientConfig } from '@aws-sdk/client-ses';
export type SESAdapterArgs = {
    /**
     * AWS SES client configuration.
     * Pass `region`, `credentials`, etc. here.
     * If omitted, the SDK will use the default credential provider chain
     * (env vars, IAM role, ~/.aws/credentials, etc.)
     */
    sesClientConfig?: SESClientConfig;
    /**
     * The default "from" email address used when none is specified in the message.
     */
    defaultFromAddress: string;
    /**
     * The default "from" name used when none is specified in the message.
     */
    defaultFromName: string;
    /**
     * Optional: override the SES configuration set name for tracking.
     */
    configurationSetName?: string;
    /**
     * Override all recipient addresses. Useful for testing/staging.
     */
    overrideRecipientAddress?: string;
};
type SESAdapterResponse = {
    messageId: string;
};
type SESEmailAdapter = EmailAdapter<SESAdapterResponse>;
/**
 * Email adapter for AWS SES (Simple Email Service) using the AWS SDK v3.
 *
 * Uses SendRawEmail to support HTML, text, and attachments via MIME message construction.
 *
 * @example
 * ```ts
 * import { buildConfig } from 'payload'
 * import { sesAdapter } from '@schematical/payload-email-ses'
 *
 * export default buildConfig({
 *   email: sesAdapter({
 *     defaultFromAddress: 'hello@schematical.com',
 *     defaultFromName: 'Schematical',
 *     sesClientConfig: {
 *       region: 'us-east-1',
 *       // credentials are optional if using IAM roles or env vars
 *     },
 *   }),
 * })
 * ```
 */
export declare const sesAdapter: (args: SESAdapterArgs) => SESEmailAdapter;
export {};
//# sourceMappingURL=index.d.ts.map
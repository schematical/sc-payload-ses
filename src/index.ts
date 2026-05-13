import type { EmailAdapter, SendEmailOptions } from 'payload'

import {
  SESClient,
  SendRawEmailCommand,
  type SESClientConfig,
} from '@aws-sdk/client-ses'
import { APIError } from 'payload'

export type SESAdapterArgs = {
  /**
   * AWS SES client configuration.
   * Pass `region`, `credentials`, etc. here.
   * If omitted, the SDK will use the default credential provider chain
   * (env vars, IAM role, ~/.aws/credentials, etc.)
   */
  sesClientConfig?: SESClientConfig

  /**
   * The default "from" email address used when none is specified in the message.
   */
  defaultFromAddress: string

  /**
   * The default "from" name used when none is specified in the message.
   */
  defaultFromName: string

  /**
   * Optional: override the SES configuration set name for tracking.
   */
  configurationSetName?: string

  /**
   * Override all recipient addresses. Useful for testing/staging.
   */
  overrideRecipientAddress?: string
}

type SESAdapterResponse = {
  messageId: string
}

type SESEmailAdapter = EmailAdapter<SESAdapterResponse>

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
export const sesAdapter = (args: SESAdapterArgs): SESEmailAdapter => {
  const { defaultFromAddress, defaultFromName, sesClientConfig, configurationSetName } = args

  const adapter: SESEmailAdapter = () => {
    const client = new SESClient(sesClientConfig ?? {})

    return {
      name: 'aws-ses',
      defaultFromAddress,
      defaultFromName,
      sendEmail: async (message: SendEmailOptions): Promise<SESAdapterResponse> => {
        const modifiedMessage = {
          ...message,
          ...(args.overrideRecipientAddress ? { to: args.overrideRecipientAddress } : {}),
        }

        const from = formatFromAddress(modifiedMessage.from, defaultFromName, defaultFromAddress)
        const to = normalizeAddresses(modifiedMessage.to)
        const cc = normalizeAddresses(modifiedMessage.cc)
        const bcc = normalizeAddresses(modifiedMessage.bcc)
        const replyTo = normalizeAddresses(modifiedMessage.replyTo)
        const subject = modifiedMessage.subject ?? '(No Subject)'

        const htmlBody = modifiedMessage.html?.toString() || ''
        const textBody = modifiedMessage.text?.toString() || ''
        const attachments = modifiedMessage.attachments || []

        // Build raw MIME message
        const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`
        const mixedBoundary = `----=_Mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`

        let rawMessage = ''

        // Headers
        rawMessage += `From: ${from}\r\n`
        rawMessage += `To: ${to.join(', ')}\r\n`
        if (cc.length > 0) rawMessage += `Cc: ${cc.join(', ')}\r\n`
        if (replyTo.length > 0) rawMessage += `Reply-To: ${replyTo.join(', ')}\r\n`
        rawMessage += `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\n`
        rawMessage += `MIME-Version: 1.0\r\n`

        if (attachments.length > 0) {
          // Multipart/mixed for attachments
          rawMessage += `Content-Type: multipart/mixed; boundary="${mixedBoundary}"\r\n\r\n`
          rawMessage += `--${mixedBoundary}\r\n`

          // Body part (multipart/alternative for html + text)
          if (htmlBody && textBody) {
            rawMessage += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`
            rawMessage += `--${boundary}\r\n`
            rawMessage += `Content-Type: text/plain; charset=UTF-8\r\n`
            rawMessage += `Content-Transfer-Encoding: 7bit\r\n\r\n`
            rawMessage += `${textBody}\r\n\r\n`
            rawMessage += `--${boundary}\r\n`
            rawMessage += `Content-Type: text/html; charset=UTF-8\r\n`
            rawMessage += `Content-Transfer-Encoding: 7bit\r\n\r\n`
            rawMessage += `${htmlBody}\r\n\r\n`
            rawMessage += `--${boundary}--\r\n\r\n`
          } else if (htmlBody) {
            rawMessage += `Content-Type: text/html; charset=UTF-8\r\n`
            rawMessage += `Content-Transfer-Encoding: 7bit\r\n\r\n`
            rawMessage += `${htmlBody}\r\n\r\n`
          } else {
            rawMessage += `Content-Type: text/plain; charset=UTF-8\r\n`
            rawMessage += `Content-Transfer-Encoding: 7bit\r\n\r\n`
            rawMessage += `${textBody}\r\n\r\n`
          }

          // Attachments
          for (const attachment of attachments) {
            const filename = attachment.filename || 'attachment'
            const contentType = attachment.contentType || 'application/octet-stream'
            let contentBase64 = ''

            if (attachment.content) {
              if (Buffer.isBuffer(attachment.content)) {
                contentBase64 = attachment.content.toString('base64')
              } else if (typeof attachment.content === 'string') {
                contentBase64 = Buffer.from(attachment.content).toString('base64')
              }
            } else if (attachment.path) {
              // For path-based attachments, we need to fetch the content
              const pathStr = typeof attachment.path === 'string' ? attachment.path : attachment.path.href
              if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
                const response = await fetch(pathStr)
                const arrayBuffer = await response.arrayBuffer()
                contentBase64 = Buffer.from(arrayBuffer).toString('base64')
              } else {
                // Local file - use dynamic import for fs
                const { readFile } = await import('node:fs/promises')
                const fileBuffer = await readFile(pathStr)
                contentBase64 = fileBuffer.toString('base64')
              }
            }

            if (contentBase64) {
              rawMessage += `--${mixedBoundary}\r\n`
              rawMessage += `Content-Type: ${contentType}; name="${filename}"\r\n`
              rawMessage += `Content-Disposition: attachment; filename="${filename}"\r\n`
              rawMessage += `Content-Transfer-Encoding: base64\r\n\r\n`
              // Split base64 into 76-char lines per MIME spec
              rawMessage += contentBase64.replace(/(.{76})/g, '$1\r\n') + '\r\n\r\n'
            }
          }

          rawMessage += `--${mixedBoundary}--\r\n`
        } else {
          // No attachments
          if (htmlBody && textBody) {
            rawMessage += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`
            rawMessage += `--${boundary}\r\n`
            rawMessage += `Content-Type: text/plain; charset=UTF-8\r\n`
            rawMessage += `Content-Transfer-Encoding: 7bit\r\n\r\n`
            rawMessage += `${textBody}\r\n\r\n`
            rawMessage += `--${boundary}\r\n`
            rawMessage += `Content-Type: text/html; charset=UTF-8\r\n`
            rawMessage += `Content-Transfer-Encoding: 7bit\r\n\r\n`
            rawMessage += `${htmlBody}\r\n\r\n`
            rawMessage += `--${boundary}--\r\n`
          } else if (htmlBody) {
            rawMessage += `Content-Type: text/html; charset=UTF-8\r\n`
            rawMessage += `Content-Transfer-Encoding: 7bit\r\n\r\n`
            rawMessage += `${htmlBody}\r\n`
          } else {
            rawMessage += `Content-Type: text/plain; charset=UTF-8\r\n`
            rawMessage += `Content-Transfer-Encoding: 7bit\r\n\r\n`
            rawMessage += `${textBody}\r\n`
          }
        }

        const destinations = [...to, ...cc, ...bcc]

        try {
          const command = new SendRawEmailCommand({
            RawMessage: {
              Data: new TextEncoder().encode(rawMessage),
            },
            Source: from,
            Destinations: destinations,
            ...(configurationSetName ? { ConfigurationSetName: configurationSetName } : {}),
          })

          const result = await client.send(command)



          return {
            messageId: result.MessageId ?? '',
          }
        } catch (error: unknown) {
          const err = error as Error & { $metadata?: { httpStatusCode?: number } }
          const statusCode = err.$metadata?.httpStatusCode ?? 500
          throw new APIError(
            `AWS SES error: ${err.message || 'Unknown error'}`,
            statusCode,
          )
        }
      },
    }
  }

  return adapter
}

// --- Helper functions ---

function formatFromAddress(
  from: SendEmailOptions['from'],
  defaultFromName: string,
  defaultFromAddress: string,
): string {
  if (!from) {
    return `${defaultFromName} <${defaultFromAddress}>`
  }

  if (typeof from === 'string') {
    return from
  }

  if (typeof from === 'object' && 'address' in from) {
    const name = from.name || defaultFromName
    return `${name} <${from.address}>`
  }

  return `${defaultFromName} <${defaultFromAddress}>`
}

function normalizeAddresses(
  addresses: SendEmailOptions['to'] | SendEmailOptions['cc'] | SendEmailOptions['bcc'] | SendEmailOptions['replyTo'],
): string[] {
  if (!addresses) return []

  if (typeof addresses === 'string') {
    return [addresses]
  }

  if (Array.isArray(addresses)) {
    return addresses.map((addr) => {
      if (typeof addr === 'string') return addr
      if (typeof addr === 'object' && 'address' in addr) return addr.address
      return ''
    }).filter(Boolean)
  }

  if (typeof addresses === 'object' && 'address' in addresses) {
    return [addresses.address]
  }

  return []
}

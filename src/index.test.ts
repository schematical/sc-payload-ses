import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the AWS SES client before importing the adapter
const mockSend = vi.fn()

vi.mock('@aws-sdk/client-ses', () => {
  const SESClient = function (this: any) {
    this.send = mockSend
  } as any
  return {
    SESClient,
    SendRawEmailCommand: function (this: any, input: any) {
      Object.assign(this, input)
      return input
    } as any,
  }
})

// Mock payload's APIError
vi.mock('payload', () => ({
  APIError: class APIError extends Error {
    statusCode: number
    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
      this.name = 'APIError'
    }
  },
}))

import { sesAdapter } from '../src/index.js'

describe('sesAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({ MessageId: 'test-message-id-123' })
  })

  describe('adapter factory', () => {
    it('should return a function (adapter factory)', () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'test@example.com',
        defaultFromName: 'Test',
      })
      expect(typeof adapter).toBe('function')
    })

    it('should return an initialized adapter with correct properties', () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'test@example.com',
        defaultFromName: 'Test Sender',
      })

      const initialized = adapter({ payload: {} as any })

      expect(initialized.name).toBe('aws-ses')
      expect(initialized.defaultFromAddress).toBe('test@example.com')
      expect(initialized.defaultFromName).toBe('Test Sender')
      expect(typeof initialized.sendEmail).toBe('function')
    })
  })

  describe('sendEmail', () => {
    it('should send a basic text email', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      const result = await sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Hello, World!',
      })

      expect(result.messageId).toBe('test-message-id-123')
      expect(mockSend).toHaveBeenCalledTimes(1)

      // Verify the command was called with correct structure
      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.Source).toBe('Sender <sender@example.com>')
      expect(commandArg.Destinations).toContain('recipient@example.com')
      expect(commandArg.RawMessage.Data).toBeInstanceOf(Uint8Array)

      // Decode and check raw message content
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('To: recipient@example.com')
      expect(rawMessage).toContain('Hello, World!')
      expect(rawMessage).toContain('Content-Type: text/plain')
    })

    it('should send an HTML email', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'recipient@example.com',
        subject: 'HTML Test',
        html: '<h1>Hello</h1>',
      })

      const commandArg = mockSend.mock.calls[0][0]
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('<h1>Hello</h1>')
      expect(rawMessage).toContain('Content-Type: text/html')
    })

    it('should send multipart alternative when both html and text are provided', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'recipient@example.com',
        subject: 'Both',
        text: 'Plain text version',
        html: '<p>HTML version</p>',
      })

      const commandArg = mockSend.mock.calls[0][0]
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('multipart/alternative')
      expect(rawMessage).toContain('Plain text version')
      expect(rawMessage).toContain('<p>HTML version</p>')
    })

    it('should handle multiple recipients', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: ['one@example.com', 'two@example.com'],
        subject: 'Multi',
        text: 'Hi all',
      })

      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.Destinations).toContain('one@example.com')
      expect(commandArg.Destinations).toContain('two@example.com')

      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('To: one@example.com, two@example.com')
    })

    it('should handle CC and BCC', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'to@example.com',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        subject: 'CC/BCC test',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.Destinations).toContain('to@example.com')
      expect(commandArg.Destinations).toContain('cc@example.com')
      expect(commandArg.Destinations).toContain('bcc@example.com')

      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('Cc: cc@example.com')
      // BCC should NOT appear in headers (only in Destinations)
      expect(rawMessage).not.toContain('Bcc:')
    })

    it('should handle Reply-To', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'to@example.com',
        replyTo: 'reply@example.com',
        subject: 'Reply-To test',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('Reply-To: reply@example.com')
    })

    it('should use custom from address when provided', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'default@example.com',
        defaultFromName: 'Default',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        from: 'custom@example.com',
        to: 'to@example.com',
        subject: 'Custom from',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.Source).toBe('custom@example.com')
    })

    it('should use custom from object with name and address', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'default@example.com',
        defaultFromName: 'Default',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        from: { name: 'Custom Name', address: 'custom@example.com' },
        to: 'to@example.com',
        subject: 'Custom from object',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.Source).toBe('Custom Name <custom@example.com>')
    })

    it('should encode subject as UTF-8 base64', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      const subject = 'Héllo Wörld 🌍'

      await sendEmail({
        to: 'to@example.com',
        subject,
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)

      const expectedEncoded = Buffer.from(subject).toString('base64')
      expect(rawMessage).toContain(`=?UTF-8?B?${expectedEncoded}?=`)
    })

    it('should override recipient when overrideRecipientAddress is set', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
        overrideRecipientAddress: 'override@example.com',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'original@example.com',
        subject: 'Override test',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.Destinations).toContain('override@example.com')
      expect(commandArg.Destinations).not.toContain('original@example.com')
    })

    it('should include ConfigurationSetName when provided', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
        configurationSetName: 'my-config-set',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'to@example.com',
        subject: 'Config set test',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.ConfigurationSetName).toBe('my-config-set')
    })

    it('should not include ConfigurationSetName when not provided', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'to@example.com',
        subject: 'No config set',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.ConfigurationSetName).toBeUndefined()
    })

    it('should handle Buffer attachments', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      const fileContent = Buffer.from('file content here')

      await sendEmail({
        to: 'to@example.com',
        subject: 'Attachment test',
        text: 'See attached',
        attachments: [
          {
            filename: 'test.txt',
            content: fileContent,
            contentType: 'text/plain',
          },
        ],
      })

      const commandArg = mockSend.mock.calls[0][0]
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('Content-Disposition: attachment; filename="test.txt"')
      expect(rawMessage).toContain('Content-Transfer-Encoding: base64')
      expect(rawMessage).toContain(fileContent.toString('base64'))
    })

    it('should handle string content attachments', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'to@example.com',
        subject: 'String attachment',
        text: 'See attached',
        attachments: [
          {
            filename: 'data.csv',
            content: 'col1,col2\nA,B\n',
            contentType: 'text/csv',
          },
        ],
      })

      const commandArg = mockSend.mock.calls[0][0]
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('Content-Disposition: attachment; filename="data.csv"')
      expect(rawMessage).toContain(Buffer.from('col1,col2\nA,B\n').toString('base64'))
    })

    it('should handle remote URL attachments', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      // Mock global fetch
      const mockFetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode('remote file content').buffer),
      })
      vi.stubGlobal('fetch', mockFetch)

      await sendEmail({
        to: 'to@example.com',
        subject: 'URL attachment',
        text: 'See attached',
        attachments: [
          {
            filename: 'remote.pdf',
            path: 'https://example.com/file.pdf',
            contentType: 'application/pdf',
          },
        ],
      })

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/file.pdf')

      const commandArg = mockSend.mock.calls[0][0]
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      expect(rawMessage).toContain('Content-Disposition: attachment; filename="remote.pdf"')

      vi.unstubAllGlobals()
    })

    it('should throw APIError when SES returns an error', async () => {
      mockSend.mockRejectedValue(
        Object.assign(new Error('Access Denied'), {
          $metadata: { httpStatusCode: 403 },
        }),
      )

      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await expect(
        sendEmail({
          to: 'to@example.com',
          subject: 'Fail',
          text: 'Hello',
        }),
      ).rejects.toThrow('AWS SES error: Access Denied')
    })

    it('should default to 500 status when SES error has no httpStatusCode', async () => {
      mockSend.mockRejectedValue(new Error('Network error'))

      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await expect(
        sendEmail({
          to: 'to@example.com',
          subject: 'Fail',
          text: 'Hello',
        }),
      ).rejects.toMatchObject({
        statusCode: 500,
      })
    })

    it('should handle address objects in recipient arrays', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: [
          { name: 'User One', address: 'one@example.com' },
          { name: 'User Two', address: 'two@example.com' },
        ],
        subject: 'Object addresses',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      expect(commandArg.Destinations).toContain('one@example.com')
      expect(commandArg.Destinations).toContain('two@example.com')
    })

    it('should use default subject when none provided', async () => {
      const adapter = sesAdapter({
        defaultFromAddress: 'sender@example.com',
        defaultFromName: 'Sender',
      })
      const { sendEmail } = adapter({ payload: {} as any })

      await sendEmail({
        to: 'to@example.com',
        text: 'Hello',
      })

      const commandArg = mockSend.mock.calls[0][0]
      const rawMessage = new TextDecoder().decode(commandArg.RawMessage.Data)
      const expectedSubject = Buffer.from('(No Subject)').toString('base64')
      expect(rawMessage).toContain(`=?UTF-8?B?${expectedSubject}?=`)
    })
  })
})

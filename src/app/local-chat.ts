/** A loopback operator conversation source, persisted in the orchestrator database. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { family } from '../kv.ts'
import { allowedSender } from '../policy.ts'
import type { ReceiveResult, Trigger } from '../core/index.ts'
import type { SourceKind } from '../sources/kind.ts'
import type { Store } from './store.ts'

export type ChatAgent = 'auto' | 'deepseek' | 'codex' | 'claude'
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; at: string; agent?: ChatAgent }
export interface ChatConversation { id: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }
const conversations = family<ChatConversation>('local-chat:')
const operator = { source: 'local', id: 'operator' }

/** Local chat uses its own explicit source identity; it never impersonates a GitHub user. */
export class LocalChat {
  constructor(private readonly store: Store, private readonly receive: (trigger: Trigger) => ReceiveResult) {}
  kind(): SourceKind<Record<string, never>> {
    return {
      kind: 'local', title: { en: 'Local chat', zh: '本地聊天' }, description: { en: 'Requests from the local operator', zh: '本地操作员请求' },
      schema: z.object({}).strict(), fields: [], health: [],
      policy: { schema: z.object({ allowed: z.array(z.object({ id: z.string(), name: z.string().optional() }).strict()).default([]) }).strict(),
        fields: [], explicit: { en: 'A direct request from an allowed local operator', zh: '来自已授权本地操作员的直接请求' } },
      channel: {
        send: async (_host, message) => {
          const id = message.channel.address.id, chat = id && this.get(id)
          if (!chat) return 'gone'
          if (!chat.messages.some(item => item.id === message.id)) {
            const at = new Date().toISOString()
            this.store.set(conversations(chat.id), { ...chat, updatedAt: at, messages: [...chat.messages, { id: message.id, role: 'assistant', text: message.text, at }] })
          }
          return 'sent'
        },
        link: () => ({ url: '', label: { en: 'Local chat', zh: '本地聊天' } }),
      },
      threadContext: {
        messageId: trigger => trigger.id,
        read: async (_commands, trigger) => {
          const chat = this.get(trigger.threads[0]!.id)
          return { messages: (chat?.messages ?? []).map(message => ({ id: message.id, from: message.role === 'user' ? 'operator' : 'agent', at: message.at, text: message.text, ...(message.role === 'assistant' ? { bot: true as const } : {}) })), body: {} }
        },
      },
    }
  }
  list() {
    return this.store.keys(conversations).flatMap(name => {
      const chat = this.store.get(name)
      return chat ? [{ id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt }] : []
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  create(title?: string) {
    const id = randomUUID(), at = new Date().toISOString()
    const chat: ChatConversation = { id, title: title?.trim() || 'Nouvelle conversation', createdAt: at, updatedAt: at, messages: [] }
    this.store.set(conversations(id), chat)
    return { id, title: chat.title, createdAt: at, updatedAt: at }
  }
  get(id: string): ChatConversation | undefined { return this.store.get(conversations(id)) }
  detail(id: string) {
    const chat = this.get(id)
    if (!chat) return undefined
    const thread = this.store.threads.get(`local:${id}`)
    const tickets = (thread?.subscriptions ?? []).flatMap(ticketId => {
      const ticket = this.store.tickets.get(ticketId)
      return ticket ? [{ id: ticket.id, title: ticket.title, state: ticket.ended ? 'ended' : 'open' }] : []
    })
    return { ...chat, tickets }
  }
  post(id: string, text: string, agent: ChatAgent = 'auto'): ChatMessage {
    const chat = this.get(id)
    if (!chat) throw new Error('Conversation not found')
    if (!allowedSender(this.store.settings(), operator)) throw new Error('Local operator is not authorized in Source policy')
    const at = new Date().toISOString(), message: ChatMessage = { id: randomUUID(), role: 'user', text, at, agent }
    const instruction = agent === 'auto' ? '' : `\n\nOperator-selected coding agent: ${agent}. The orchestrator may plan and coordinate, but implementation must use only the selected agent. Never silently substitute another agent; report if unavailable.`
    const trigger: Trigger = { id: message.id, source: 'local', threads: [{ source: 'local', id }], actor: operator, human: true,
      addressed: 'direct', at, text: text + instruction, meta: { agent }, channel: { source: 'local', thread: `local:${id}`, address: { id } } }
    return this.store.atomic(() => {
      const result = this.receive(trigger)
      if (result !== 'stored') throw new Error(`Local message was ${result}`)
      this.store.set(conversations(id), { ...chat, updatedAt: at, messages: [...chat.messages, message] })
      return message
    })
  }
}

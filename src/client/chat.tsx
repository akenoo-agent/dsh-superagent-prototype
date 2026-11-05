import { useCallback, useState } from 'react'
import { Button, Input } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import type { DshSuperagentKey } from './locales.ts'
import type { ApiResponse, ChatAgent } from '../app/api.ts'
import { usePoll } from './api.ts'

type List = ApiResponse<'GET chat/conversations'>['items']
type Detail = ApiResponse<'GET chat/conversations/:id'>
const agents: ChatAgent[] = ['auto', 'codex', 'claude', 'deepseek']
export function ChatPage() {
  const { t, call, navigate, notify } = usePanel()
  const [selected, setSelected] = useState('')
  const [agent, setAgent] = useState<ChatAgent>('auto')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const loadList = useCallback(() => call('GET chat/conversations'), [call])
  const { data: list, error, reload } = usePoll(loadList, [loadList])
  const id = selected || list?.items[0]?.id || ''
  const loadDetail = useCallback(() => id ? call('GET chat/conversations/:id', { id }) : Promise.resolve(undefined), [call, id])
  const { data: detail, reload: reloadDetail } = usePoll(loadDetail, [loadDetail])
  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      let conversationId = id
      if (!conversationId) {
        const conversation = await call('POST chat/conversations', { body: { title: text.slice(0, 80) } })
        conversationId = conversation.id
        setSelected(conversationId)
      }
      await call('POST chat/conversations/:id/messages', { id: conversationId, body: { text, agent } })
      setDraft('')
      await Promise.all([reload(), reloadDetail()])
    } catch (failure) { notify(errorText(failure)) }
    finally { setBusy(false) }
  }
  const create = async () => {
    try { const value = await call('POST chat/conversations', { body: {} }); setSelected(value.id); await reload() }
    catch (failure) { notify(errorText(failure)) }
  }
  return <section className="dt-card" aria-label="Chat">
    <div className="dt-card-head"><div className="dt-row-main"><h2 className="dt-card-title">{t('chatTitle')}</h2><p className="dt-hint">{t('chatHint')}</p></div>
      <Button variant="outline" onClick={() => void create()}>{t('chatNew')}</Button></div>
    {error && <p className="dt-error" role="alert">{error.message}</p>}
    <label className="dt-field">{t('chatConversation')}<select className="dt-select" value={id} onChange={event => setSelected(event.target.value)}>
      {!list?.items.length && <option value="">{t('chatEmpty')}</option>}
      {(list?.items ?? []).map((item: List[number]) => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select></label>
    <div className="dt-chat-messages" aria-live="polite">{(detail?.messages ?? []).map(message => <article key={message.id} className={`dt-chat-message dt-chat-${message.role}`}>
      <strong>{message.role === 'user' ? t('chatYou') : t('chatAssistant')}</strong><p>{message.text}</p>
    </article>)}</div>
    {!!detail?.tickets.length && <div className="dt-chat-tickets"><strong>{t('chatTickets')}</strong>{detail.tickets.map(ticket => <Button key={ticket.id} variant="ghost" onClick={() => navigate({ page: 'execution', id: ticket.id })}>{ticket.title}</Button>)}</div>}
    <label className="dt-field">{t('chatAgent')}<select className="dt-select" value={agent} onChange={event => setAgent(event.target.value as ChatAgent)}>
      {agents.map(value => <option key={value} value={value}>{t(`chatAgent.${value}` as DshSuperagentKey)}</option>)}
    </select></label>
    <form className="dt-form dt-chat-compose" onSubmit={event => { event.preventDefault(); void send() }}>
      <textarea className="dt-textarea" value={draft} onChange={event => setDraft(event.target.value)} rows={4} maxLength={20000} placeholder={t('chatPlaceholder')} />
      <Button variant="primary" disabled={busy || !draft.trim()}>{busy ? t('chatSending') : t('chatSend')}</Button>
    </form>
  </section>
}

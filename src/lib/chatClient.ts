/**
 * chatClient.ts – all Supabase operations for the WatchDog chat system.
 */
import { getSupabase } from './supabase'

export const ADMIN_EMAIL = 'adhikariA9999@gmail.com'

export interface ChatProfile {
  user_id:    string
  username:   string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface ChatChannel {
  id:          string
  name:        string
  description: string | null
  type:        'public' | 'dm'
  created_by:  string | null
  created_at:  string
}

export interface RawChatMessage {
  id:          string
  channel_id:  string
  user_id:     string
  content:     string | null
  file_url:    string | null
  file_name:   string | null
  file_type:   string | null
  file_size:   number | null
  reply_to_id: string | null
  is_edited:   boolean
  is_deleted:  boolean
  created_at:  string
  updated_at:  string
}

export interface ChatReaction {
  id:         string
  message_id: string
  user_id:    string
  emoji:      string
  created_at: string
}

export interface ChatDMChannel {
  id:         string
  user1_id:   string
  user2_id:   string
  created_at: string
}

export interface PresenceEntry {
  user_id:    string
  username:   string
  avatar_url: string | null
  online_at:  string
}

export async function getProfile(userId: string): Promise<ChatProfile | null> {
  const sb = await getSupabase()
  const { data } = await sb.from('chat_profiles').select('*').eq('user_id', userId).single()
  return (data as ChatProfile) ?? null
}

export async function getAllProfiles(): Promise<ChatProfile[]> {
  const sb = await getSupabase()
  const { data } = await sb.from('chat_profiles').select('*')
  return (data ?? []) as ChatProfile[]
}

export async function upsertProfile(userId: string, username: string, avatarUrl?: string | null): Promise<ChatProfile | null> {
  const sb = await getSupabase()
  const { data, error } = await sb.from('chat_profiles')
    .upsert({ user_id: userId, username, avatar_url: avatarUrl ?? null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select().single()
  if (error) { console.error('[chatClient] upsertProfile:', error.message); return null }
  return data as ChatProfile
}

export async function uploadAvatar(userId: string, file: File): Promise<string | null> {
  const sb = await getSupabase()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `avatars/${userId}.${ext}`
  const { error } = await sb.storage.from('chat-files').upload(path, file, { upsert: true, contentType: file.type })
  if (error) { console.error('[chatClient] uploadAvatar:', error.message); return null }
  return sb.storage.from('chat-files').getPublicUrl(path).data.publicUrl
}

export async function getChannels(): Promise<ChatChannel[]> {
  const sb = await getSupabase()
  const { data } = await sb.from('chat_channels').select('*').eq('type', 'public').order('created_at', { ascending: true })
  return (data ?? []) as ChatChannel[]
}

export async function createChannel(name: string, description?: string, createdBy?: string): Promise<ChatChannel | null> {
  const sb = await getSupabase()
  const { data, error } = await sb.from('chat_channels')
    .insert({ name: name.toLowerCase().replace(/\s+/g, '-'), description: description ?? null, created_by: createdBy ?? null })
    .select().single()
  if (error) { console.error('[chatClient] createChannel:', error.message); return null }
  return data as ChatChannel
}

export async function renameChannel(id: string, name: string): Promise<boolean> {
  const sb = await getSupabase()
  const { error } = await sb.from('chat_channels').update({ name: name.toLowerCase().replace(/\s+/g, '-') }).eq('id', id)
  return !error
}

export async function deleteChannel(id: string): Promise<boolean> {
  const sb = await getSupabase()
  const { error } = await sb.from('chat_channels').delete().eq('id', id)
  return !error
}

export async function fetchMessages(channelId: string, limit = 50, before?: string): Promise<RawChatMessage[]> {
  const sb = await getSupabase()
  let q = sb.from('chat_messages').select('*').eq('channel_id', channelId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(limit)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q
  if (error) { console.error('[chatClient] fetchMessages:', error.message); return [] }
  return ([...(data ?? [])].reverse()) as RawChatMessage[]
}

export async function sendMessage(p: { channelId: string; userId: string; content?: string; fileUrl?: string; fileName?: string; fileType?: string; fileSize?: number; replyToId?: string }): Promise<RawChatMessage | null> {
  const sb = await getSupabase()
  const { data, error } = await sb.from('chat_messages')
    .insert({ channel_id: p.channelId, user_id: p.userId, content: p.content ?? null, file_url: p.fileUrl ?? null, file_name: p.fileName ?? null, file_type: p.fileType ?? null, file_size: p.fileSize ?? null, reply_to_id: p.replyToId ?? null })
    .select().single()
  if (error) { console.error('[chatClient] sendMessage:', error.message); return null }
  return data as RawChatMessage
}

export async function editMessage(id: string, content: string): Promise<boolean> {
  const sb = await getSupabase()
  const { error } = await sb.from('chat_messages').update({ content, is_edited: true, updated_at: new Date().toISOString() }).eq('id', id)
  return !error
}

export async function softDeleteMessage(id: string): Promise<boolean> {
  const sb = await getSupabase()
  const { error } = await sb.from('chat_messages').update({ is_deleted: true, content: null, file_url: null, updated_at: new Date().toISOString() }).eq('id', id)
  return !error
}

export async function uploadChatFile(userId: string, file: File): Promise<{ url: string; name: string; type: string; size: number } | null> {
  const sb = await getSupabase()
  const path = `files/${userId}/${Date.now()}-${file.name}`
  const { error } = await sb.storage.from('chat-files').upload(path, file, { contentType: file.type, upsert: false })
  if (error) { console.error('[chatClient] uploadFile:', error.message); return null }
  const url = sb.storage.from('chat-files').getPublicUrl(path).data.publicUrl
  return { url, name: file.name, type: file.type, size: file.size }
}

export async function fetchReactionsForChannel(channelId: string): Promise<ChatReaction[]> {
  const sb = await getSupabase()
  const { data: msgs } = await sb.from('chat_messages').select('id').eq('channel_id', channelId).eq('is_deleted', false)
  if (!msgs || msgs.length === 0) return []
  const ids = (msgs as { id: string }[]).map((m) => m.id)
  const { data } = await sb.from('chat_reactions').select('*').in('message_id', ids)
  return (data ?? []) as ChatReaction[]
}

export async function addReaction(messageId: string, userId: string, emoji: string): Promise<boolean> {
  const sb = await getSupabase()
  const { error } = await sb.from('chat_reactions').upsert({ message_id: messageId, user_id: userId, emoji }, { onConflict: 'message_id,user_id,emoji' })
  return !error
}

export async function removeReaction(messageId: string, userId: string, emoji: string): Promise<boolean> {
  const sb = await getSupabase()
  const { error } = await sb.from('chat_reactions').delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji)
  return !error
}

export async function banUser(channelId: string | null, userId: string, bannedBy: string, reason?: string): Promise<boolean> {
  const sb = await getSupabase()
  const { error } = await sb.from('chat_bans').insert({ channel_id: channelId, user_id: userId, banned_by: bannedBy, reason: reason ?? null })
  return !error
}

export async function getOrCreateDM(userId: string, otherUserId: string): Promise<ChatDMChannel | null> {
  const sb = await getSupabase()
  const [a, b] = [userId, otherUserId].sort()
  const { data: existing } = await sb.from('chat_dm_channels').select('*').or(`and(user1_id.eq.${a},user2_id.eq.${b}),and(user1_id.eq.${b},user2_id.eq.${a})`).maybeSingle()
  if (existing) return existing as ChatDMChannel
  const { data, error } = await sb.from('chat_dm_channels').insert({ user1_id: a, user2_id: b }).select().single()
  if (error) { console.error('[chatClient] createDM:', error.message); return null }
  return data as ChatDMChannel
}

export async function getMyDMChannels(userId: string): Promise<ChatDMChannel[]> {
  const sb = await getSupabase()
  const { data } = await sb.from('chat_dm_channels').select('*').or(`user1_id.eq.${userId},user2_id.eq.${userId}`).order('created_at', { ascending: false })
  return (data ?? []) as ChatDMChannel[]
}
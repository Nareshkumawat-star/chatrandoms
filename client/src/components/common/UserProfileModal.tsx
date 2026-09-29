import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../lib/api';
import type { PublicUser, Relationship } from '../../types';
import Avatar from './Avatar';
import Modal from './Modal';
import GlowButton from '../uiverse/GlowButton';
import { MessageCircle, ShieldBan, VolumeX, Flag, Clock } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../store/auth';
import { useUi } from '../../store/ui';

interface Props {
  userId: string | null;
  onClose: () => void;
}

/** Profile preview + actions. Used from Global Chat messages and search results. */
export default function UserProfileModal({ userId, onClose }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [error, setError] = useState('');
  const [reported, setReported] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['user', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const res = await api.get(`/users/${userId}`);
      return res.data as { user: PublicUser; viewerRelationship: Relationship };
    },
  });

  const startChat = useMutation({
    mutationFn: async (username: string) => {
      const res = await api.post('/chats/direct', { username });
      return res.data as { conversation: { id: string } };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['chats'] });
      onClose();
      navigate('/app/chats');
      useUi.getState().requestOpenConversation(data.conversation.id);
    },
    onError: (e) => setError(apiError(e)),
  });

  const toggleBlock = useMutation({
    mutationFn: async (id: string) => (await api.post(`/users/${id}/block`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', userId] }),
    onError: (e) => setError(apiError(e)),
  });

  const toggleMute = useMutation({
    mutationFn: async (id: string) => (await api.post(`/users/${id}/mute`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', userId] }),
    onError: (e) => setError(apiError(e)),
  });

  const report = useMutation({
    mutationFn: async (id: string) =>
      (
        await api.post(`/users/${id}/report`, {
          reason: 'inappropriate',
          details: 'Reported from profile modal',
        })
      ).data,
    onSuccess: () => setReported(true),
    onError: (e) => setError(apiError(e)),
  });

  const user = data?.user;
  const rel = data?.viewerRelationship;
  const isSelf = me?.id === userId;

  return (
    <Modal open={Boolean(userId)} onClose={onClose} title="Profile">
      {isLoading || !user ? (
        <div className="space-y-3">
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-4 w-1/2" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar src={user.avatar || undefined} name={user.displayName} size={64} online={user.online} />
            <div className="min-w-0">
              <div className="font-semibold text-lg text-slate-100 truncate">{user.displayName}</div>
              <div className="text-sm text-sky-400">@{user.username}</div>
              <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                {user.online ? (
                  <>
                    <span className="pulse-dot inline-block" /> Online
                  </>
                ) : (
                  <>
                    <Clock size={12} /> last seen {new Date(user.lastSeen).toLocaleString()}
                  </>
                )}
              </div>
            </div>
          </div>

          {user.bio && <p className="text-sm text-slate-400">{user.bio}</p>}

          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>⭐ Reputation: {user.reputation}</span>
            {user.isGuest && <span className="text-amber-400">Guest account</span>}
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          {!isSelf && (
            <div className="flex flex-wrap gap-2">
              <GlowButton
                variant="primary"
                disabled={user.isGuest || rel?.blockedMe || rel?.iBlocked}
                onClick={() => startChat.mutate(user.username)}
              >
                <MessageCircle size={16} /> Message
              </GlowButton>
              <GlowButton onClick={() => toggleBlock.mutate(user.id)}>
                <ShieldBan size={16} /> {rel?.iBlocked ? 'Unblock' : 'Block'}
              </GlowButton>
              <GlowButton onClick={() => toggleMute.mutate(user.id)}>
                <VolumeX size={16} /> {rel?.iMuted ? 'Unmute' : 'Mute'}
              </GlowButton>
              <GlowButton disabled={reported} onClick={() => report.mutate(user.id)}>
                <Flag size={16} /> {reported ? 'Reported' : 'Report'}
              </GlowButton>
            </div>
          )}

          {user.isGuest && (
            <p className="text-xs text-amber-400/90">
              Guests don't have private inboxes — create an account to start private chats.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

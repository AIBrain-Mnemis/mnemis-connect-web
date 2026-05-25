import { create } from 'zustand';

export interface RemoteUser {
  userId: string;
  streamType: string;
  elementId: string;
}

interface AppState {
  remoteUsers: RemoteUser[];

  addSuccessLog: (content: string) => void;
  addFailedLog: (content: string) => void;

  addRemoteUser: (user: RemoteUser) => void;
  removeRemoteUser: (elementId: string) => void;
  clearRemoteUsers: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  remoteUsers: [],

  // 仅打到 console，不再保留内存日志（旧 LogPanel 已删除）
  addSuccessLog: (content) => console.debug('[trtc]', content),
  addFailedLog: (content) => console.warn('[trtc]', content),

  addRemoteUser: (user) => set((state) => ({ remoteUsers: [...state.remoteUsers, user] })),
  removeRemoteUser: (elementId) =>
    set((state) => ({
      remoteUsers: state.remoteUsers.filter((u) => u.elementId !== elementId),
    })),
  clearRemoteUsers: () => set({ remoteUsers: [] }),
}));

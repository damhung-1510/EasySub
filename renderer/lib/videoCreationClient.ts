import type {
  VideoCommand,
  VideoCommandInput,
  VideoCommandOutput,
} from '../../types/videoCreationIpc';
export interface VideoCreationClient {
  call<K extends VideoCommand>(
    command: K,
    payload: VideoCommandInput[K],
  ): Promise<VideoCommandOutput[K]>;
}
export const videoCreationClient: VideoCreationClient = {
  call: (command, payload) => {
    if (typeof window === 'undefined' || !window.ipc?.invoke)
      return Promise.reject(new Error('VIDEO_IPC_UNAVAILABLE'));
    return window.ipc.invoke('videoCreation:command', { command, payload });
  },
};

import fs from 'fs';
import path from 'path';
import { atomicReplaceTextFile } from '../atomicFile';
import { extractAudio } from '../audioProcessor';
import { getAudioCacheKey } from '../audioCacheKey';
import { ensureTempDir, getMd5 } from '../fileUtils';
import { logMessage } from '../storeManager';
import { isSherpaLibInstalled } from '../sherpaOnnx/sherpaLibPaths';
import { TaskCancelledError } from '../taskContext';
import { msg } from '../uiMessages';
import { readProofreadDataFile } from '../proofreadData';
import {
  getSpeakerDiarizationModelFiles,
  isSpeakerDiarizationModelInstalled,
} from '../speakerDiarization/modelCatalog';
import { getSpeakerDiarizationRuntime } from '../speakerDiarization/runtime';
import type { SpeakerDiarizationSegment } from '../speakerDiarization/alignment';
import { normalizeSpeakerDiarizationCount } from '../../../types/speakerDiarization';
import type { DubbingSession } from './dubbingProcessor';
import {
  applyAssignmentsToSidecar,
  assignSpeakersToCues,
  buildDubbingSpeakers,
} from './speakerAssign';
import { findDubbingProofreadDataFile } from './speakerMetadata';

/** Sessions whose diarization is in flight, so a second request or a cancel finds the first. */
const running = new Map<string, AbortController>();

export function cancelSessionDiarization(sessionId: string): boolean {
  const controller = running.get(sessionId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export interface SessionDiarizationResult {
  /** True when the roles were also written to the task's sidecar. */
  persisted: boolean;
}

async function prepareAudio(videoPath: string): Promise<string> {
  const key = getAudioCacheKey(videoPath) ?? getMd5(videoPath);
  const audioFile = path.join(ensureTempDir(), `${key}.wav`);
  if (!getAudioCacheKey(videoPath) || !fs.existsSync(audioFile)) {
    await extractAudio(videoPath, audioFile);
  }
  return audioFile;
}

/**
 * Run speaker diarization on the media loaded in a dubbing session and attach
 * the roles to its cues. The result is also written to the sidecar of the
 * task that produced the subtitle, so reopening the session keeps it; a
 * subtitle without a sidecar keeps the roles for this session only.
 */
export async function diarizeDubbingSession(
  session: DubbingSession,
  options: { speakerCount?: number; persist: () => void },
): Promise<SessionDiarizationResult> {
  if (running.has(session.id)) {
    throw new Error(
      msg(
        '正在分离说话人，请稍候',
        'Đang tách người nói, vui lòng chờ trong giây lát',
      ),
    );
  }
  if (session.running) {
    throw new Error(
      msg(
        '配音正在进行中，请稍后再分离说话人',
        'Đang lồng tiếng, hãy tách người nói sau',
      ),
    );
  }
  if (!session.videoPath || !fs.existsSync(session.videoPath)) {
    throw new Error(
      msg(
        '请先加载视频，说话人分离需要分析音频',
        'Hãy nạp video trước, tách người nói cần phân tích âm thanh',
      ),
    );
  }
  if (!isSherpaLibInstalled() || !isSpeakerDiarizationModelInstalled()) {
    throw new Error(
      msg(
        '说话人分离模型未安装，请先在资源中心下载',
        'Chưa cài model tách người nói, hãy tải ở Trung tâm tài nguyên',
      ),
    );
  }

  const controller = new AbortController();
  running.set(session.id, controller);
  const { signal } = controller;
  try {
    const audioFile = await prepareAudio(session.videoPath);
    if (signal.aborted) throw new TaskCancelledError();

    const models = getSpeakerDiarizationModelFiles();
    const runtime = getSpeakerDiarizationRuntime();
    const { id, result } = runtime.diarize({
      audioFile,
      segmentationModel: models.segmentation,
      embeddingModel: models.embedding,
      numClusters: normalizeSpeakerDiarizationCount(options.speakerCount),
      numThreads: 2,
    });
    const onAbort = () => runtime.cancel(id);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    let segments: SpeakerDiarizationSegment[];
    try {
      segments = (await result).segments;
    } catch (error) {
      if (
        signal.aborted ||
        (error as { code?: string })?.code === 'cancelled'
      ) {
        throw new TaskCancelledError();
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw new TaskCancelledError();
    if (segments.length === 0) {
      throw new Error(
        msg(
          '未检测到有效的说话人，字幕保持不变',
          'Không phát hiện người nói hợp lệ, phụ đề giữ nguyên',
        ),
      );
    }

    const timed = session.cues.map((cue) => ({
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
    }));
    const assignments = assignSpeakersToCues(timed, segments);

    let persisted = false;
    let roster: Parameters<typeof buildDubbingSpeakers>[2] = [];
    const sidecar = findDubbingProofreadDataFile(
      session.subtitlePath,
      session.proofreadDataFile,
    );
    if (sidecar) {
      try {
        const data = await readProofreadDataFile(sidecar.filePath);
        const updated = applyAssignmentsToSidecar(data, timed, assignments);
        await atomicReplaceTextFile(
          sidecar.filePath,
          JSON.stringify(updated, null, 2),
          { signal },
        );
        roster = updated.speakers;
        session.proofreadDataFile = sidecar.filePath;
        persisted = true;
      } catch (error) {
        if (signal.aborted) throw new TaskCancelledError();
        logMessage(
          `dubbing diarization: could not write roles to the sidecar, kept for this session only: ${error}`,
          'warning',
        );
      }
    }

    session.cues.forEach((cue, index) => {
      const assignment = assignments[index];
      cue.speakerIds = [...assignment.speakerIds];
      if (assignment.primarySpeakerId) {
        cue.primarySpeakerId = assignment.primarySpeakerId;
      } else {
        delete cue.primarySpeakerId;
      }
    });
    session.speakers = buildDubbingSpeakers(timed, assignments, roster);
    // Role ids now mean different people: earlier mappings would voice the wrong one.
    session.speakerVoiceMap = {};
    session.speakerVoiceConflicts = {};
    session.speakerSettings = {};
    session.speakerSettingsConflicts = {};
    options.persist();
    logMessage(
      `dubbing diarization done: ${session.speakers.length} speaker(s), ${segments.length} segment(s), sidecar ${persisted ? 'updated' : 'not updated'}`,
      'info',
    );
    return { persisted };
  } finally {
    running.delete(session.id);
  }
}

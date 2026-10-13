/**
 * 流水线合成阶段执行体：按上游产物推导合成矩阵（有配音→替换音轨；烧录顺延字幕
 * 优先），组装作业入全局合成队列（source=pipeline，单编码槽天然串行批量），
 * 进度经作业回调转发为 composeVideo 阶段进度，产物路径落 file.finalVideoPath。
 */

import fs from 'fs';
import { logMessage, store } from '../storeManager';
import {
  TaskCancelledError,
  getTaskSignal,
  throwIfTaskCancelled,
} from '../taskContext';
import { enqueueCompose, cancelComposeJob } from '../compose/composeQueue';
import {
  deriveComposeConfig,
  resolveComposeRunOptions,
} from './deriveComposeConfig';
import type { IFiles, IFormData } from '../../../types';
import { msg } from '../uiMessages';

const STAGE_KEY = 'composeVideo';

function emitError(event: any, file: IFiles, message: string) {
  event.sender.send('taskStatusChange', file, STAGE_KEY, 'error');
  event.sender.send('taskErrorChange', file, STAGE_KEY, message);
}

const deriveErrorMessages = (): Record<string, string> => ({
  'no-subtitle': msg(
    '找不到可合成的字幕文件（txt 格式不支持烧录）',
    'Không tìm thấy tệp phụ đề để ghép (định dạng txt không hỗ trợ ghi cứng)',
  ),
  'none-without-dub': msg(
    '合成配置为不含字幕，但该文件没有配音轨，无事可做',
    'Cấu hình ghép không có phụ đề, nhưng tệp này không có track lồng tiếng nên không có gì để làm',
  ),
  'video-input-required': msg(
    '成品视频合成需要包含视频流的输入；纯音频文件请取消成品视频或改用视频文件',
    'Ghép video thành phẩm cần đầu vào có luồng video; với tệp chỉ có âm thanh, hãy bỏ video thành phẩm hoặc dùng tệp video',
  ),
});

/**
 * 执行合成阶段。成功回填 file.finalVideoPath；失败置阶段 error 并抛出。
 */
export async function runComposeStage(
  event: any,
  file: IFiles,
  formData: IFormData,
): Promise<void> {
  const compose = formData.compose!;
  event.sender.send('taskFileChange', { ...file, [STAGE_KEY]: 'loading' });
  event.sender.send('taskProgressChange', file, STAGE_KEY, 0);

  const signal = getTaskSignal();
  let jobId: string | null = null;
  const onAbort = () => {
    if (jobId) cancelComposeJob(jobId);
  };

  try {
    throwIfTaskCancelled();
    // 样式/画质/编码方式：任务快照（向导选择）优先，缺省回退合成偏好与默认样式
    const prefs = store.get('mergePreferences') as
      | {
          videoQuality?: 'original' | 'high' | 'standard';
          encoderMode?: 'cpu' | 'hardware';
        }
      | undefined;
    const runOptions = resolveComposeRunOptions(
      compose,
      prefs,
      process.platform,
    );

    const derived = deriveComposeConfig({
      file,
      compose,
      style: runOptions.style,
      videoQuality: runOptions.videoQuality,
      encoderMode: runOptions.encoderMode,
      exists: (p) => fs.existsSync(p),
    });
    if (!derived.ok) {
      const reason = (derived as { reason: string }).reason;
      throw new Error(deriveErrorMessages()[reason] || reason);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    const job = enqueueCompose(derived.config, 'pipeline', {
      onProgress: (progress) => {
        if (progress.status === 'processing') {
          event.sender.send(
            'taskProgressChange',
            file,
            STAGE_KEY,
            Math.round(progress.percent),
          );
        }
      },
    });
    jobId = job.jobId;
    logMessage(
      `compose stage enqueued: ${file.fileName} → ${derived.config.outputPath}`,
      'info',
    );

    const result = await job.done;
    if (result.cancelled || signal?.aborted) {
      throw new TaskCancelledError();
    }
    if (!result.success || !result.outputPath) {
      throw new Error(result.error || msg('合成失败', 'Ghép thất bại'));
    }

    file.finalVideoPath = result.outputPath;
    event.sender.send('taskProgressChange', file, STAGE_KEY, 100);
    event.sender.send('taskFileChange', { ...file, [STAGE_KEY]: 'done' });
    logMessage(`compose stage done: ${result.outputPath}`, 'info');
  } catch (error) {
    if (error instanceof TaskCancelledError || signal?.aborted) {
      event.sender.send('taskFileChange', { ...file, [STAGE_KEY]: '' });
      throw new TaskCancelledError();
    }
    const message = error instanceof Error ? error.message : String(error);
    logMessage(`compose stage error (${file.fileName}): ${message}`, 'error');
    emitError(event, file, message);
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

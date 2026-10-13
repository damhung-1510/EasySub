import React, { useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import type { Character, MediaAsset } from '../../../types/videoProject';
import type { ProviderPublicConfig } from '../../../types/videoProvider';
import { videoCreationClient } from '../../lib/videoCreationClient';
import { toMinor } from './money';
import type { VideoAction } from './CreativeDiscoveryPanel';
export function AssetPreview({
  projectId,
  asset,
}: {
  projectId: string;
  asset: MediaAsset;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void videoCreationClient
      .call('assetPreview', { projectId, assetId: asset.id })
      .then((result) => {
        if (active) setUrl((result as { url: string }).url);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [projectId, asset.id]);
  return error ? (
    <p role="alert">{error}</p>
  ) : url ? (
    asset.kind === 'video' ? (
      <video src={url} controls className="max-h-64 rounded" />
    ) : (
      <img
        src={url}
        alt={asset.id}
        className="max-h-48 rounded object-contain"
      />
    )
  ) : null;
}
export default function ReferenceEditor({
  projectId,
  character,
  assets,
  imageProvider,
  onAction,
  busy,
}: {
  projectId: string;
  character: Character;
  assets: MediaAsset[];
  imageProvider?: ProviderPublicConfig;
  onAction: VideoAction;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [generate, setGenerate] = useState(false);
  const [consent, setConsent] = useState(false);
  const [cap, setCap] = useState('');
  const [currency, setCurrency] = useState('USD');
  const revision = character.revisions.find(
    (r) => r.revisionId === character.currentRevisionId,
  );
  const refs = assets.filter(
    (a) =>
      a.kind === 'image' &&
      (revision?.referenceAssetIds.includes(a.id) || !a.approvedAt),
  );
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{t('cast.references')}</h4>
      <div className="flex flex-wrap gap-3">
        {refs.map((a) => (
          <div key={a.id} className="rounded border p-2">
            <AssetPreview projectId={projectId} asset={a} />
            <p className="text-xs">
              {a.approvedAt ? t('cast.approved') : t('cast.candidate')}
            </p>
            {!a.approvedAt && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void onAction('approveReference', {
                    characterId: character.id,
                    assetId: a.id,
                  })
                }
              >
                {t('cast.approveReference')}
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void onAction('importReference', { characterId: character.id })
          }
        >
          {t('cast.upload')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !imageProvider || !character.confirmed}
          onClick={() => setGenerate(!generate)}
        >
          {t('cast.generate')}
        </Button>
      </div>
      {generate && (
        <div className="space-y-2 rounded border p-3">
          <p className="text-sm">{t('cast.imageCost')}</p>
          <label className="block text-sm">
            {t('generation.budget')}
            <input
              type="number"
              min="0"
              step="0.01"
              className="ml-2 rounded border bg-background p-1"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
            <input
              aria-label={t('generation.currency')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="ml-2 w-20 rounded border bg-background p-1"
            />
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t('generation.consent')}
          </label>
          <Button
            size="sm"
            disabled={
              busy ||
              !imageProvider ||
              !consent ||
              !cap ||
              Number(cap) < 0 ||
              !Number.isFinite(Number(cap)) ||
              !/^[A-Z]{3}$/.test(currency)
            }
            onClick={() =>
              void onAction('generateReference', {
                characterId: character.id,
                imageProviderId: imageProvider?.id,
                authorized: true,
                capMinor: toMinor(Number(cap), currency),
                currency,
              })
            }
          >
            {t('cast.generate')}
          </Button>
        </div>
      )}
    </div>
  );
}

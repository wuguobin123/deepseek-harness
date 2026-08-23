import React from 'react';
import { workbenchApi } from '../api';
import { IconExternal } from './icons';

interface Props {
  artifactId: string | null;
  label?: string;
}

export function VerificationButton({ artifactId, label = '在业务系统中打开' }: Props): JSX.Element {
  const [state, setState] = React.useState<'idle' | 'opening' | 'opened' | 'failed'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  if (!artifactId) {
    return (
      <button className="btn btn--ghost" disabled>
        无关联单据
      </button>
    );
  }

  async function handleClick(): Promise<void> {
    if (!artifactId) return;
    setState('opening');
    setError(null);
    try {
      const result = await workbenchApi.openVerificationArtifact(artifactId);
      if (!result) {
        setState('failed');
        setError('后端未授权打开该单据');
        return;
      }
      setState('opened');
    } catch (err) {
      setState('failed');
      setError((err as Error).message);
    }
  }

  return (
    <div className="verification">
      <button
        type="button"
        className="btn btn--ghost"
        onClick={handleClick}
        disabled={state === 'opening'}
        data-testid="verification-button"
      >
        <IconExternal size={13} />
        {state === 'opening' ? '正在授权…' : label}
      </button>
      {state === 'opened' && <small className="ok">已授权并在外部打开。</small>}
      {state === 'failed' && <small className="err">{error ?? '打开失败'}</small>}
    </div>
  );
}

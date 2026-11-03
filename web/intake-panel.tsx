import React, { useEffect, useState } from 'react';
import type { State } from '../src/domain';
import type { IntakeRecord } from '../cloudflare/intake-store';
import { remoteApi } from './remote-api';
export function IntakePanel({ state, blocked, revision, onAnalyze, onApply }: { state: State; blocked: boolean; revision: number; onAnalyze: (mode: 'fixture' | 'meta') => void; onApply: (record: IntakeRecord) => void }) {
  const [records, setRecords] = useState<IntakeRecord[]>([]);
  const [capability, setCapability] = useState<{ status: string; reason: string } | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setRecords([]); setError('');
    void Promise.all([remoteApi(`/incidents/${state.id}/intake`), remoteApi('/capabilities')]).then(([records, capabilities]) => {
      if (current) { setRecords(records); setCapability(capabilities.model); }
    }).catch(error => { if (current) setError(String(error)); });
    return () => { current = false; };
  }, [state.id, state.version, revision, reload]);
  const record = records.at(-1), review = record?.review;
  const canApply = record?.status === 'NEEDS_REVIEW' && review?.canApply && record.version === state.version && state.uncertain;
  return <section className="panel intake-panel" aria-label="Source interpretation">
    <div className="panel-title"><h2>Interpret the source notes</h2><span className="badge amber">HUMAN REVIEW REQUIRED</span></div>
    <p className="muted">Candidate counts can help you review a note. They cannot approve a transfer or confirm an arrival.</p>
    <div className="intake-controls">
      <button className="outline" disabled={blocked || !state.uncertain} onClick={() => onAnalyze('fixture')}>Load illustrative extraction</button>
      <button className="primary" disabled={blocked || !state.uncertain || capability?.status !== 'CONFIGURED_NOT_VERIFIED'} onClick={() => onAnalyze('meta')}>Interpret with Meta</button>
    </div>
    <p className="muted">Illustrative extraction uses a fixed example for the default synthetic note. No model is called. {capability?.status === 'UNAVAILABLE' ? 'Meta access is unavailable. Manual review remains available.' : 'Meta requests require configured access and share a limit of three calls per UTC day.'}</p>
    {error && <div className="alert error" role="alert">{error}<button disabled={blocked} onClick={() => setReload(value => value + 1)}>Retry reading the interpretation</button></div>}
    {record && <div className="intake-report">
      <strong>{record.mode === 'FIXTURE_REPLAY' ? 'Illustrative replay, no AI execution' : 'Meta interpretation record'}</strong>
      <p>{record.status.replaceAll('_', ' ')} · {record.reason.replaceAll('_', ' ').toLowerCase()}</p>
      {record.provider?.usage && <p>{record.provider.usage.inputTokens} input tokens · {record.provider.usage.outputTokens} output tokens · {record.provider.latencyMs} ms</p>}
      {review?.candidate?.facts.map((fact, index) => <article className="intake-fact" key={index}>
        <strong>{state.batches.find(batch => batch.id === fact.batchId)?.name}: {fact.quantity} crates</strong>
        <span className="badge amber">{fact.confidence === 'uncertain' ? 'Uncertain, confirm' : 'Source quote found'}</span>
        <blockquote>{fact.quote}</blockquote>
      </article>)}
      {!!review?.issues.length && <p className="muted">{review.issues.map(issue => issue.replaceAll('_', ' ').toLowerCase()).join(' · ')}</p>}
      {!!review?.candidate?.questions.length && <ul>{review.candidate.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}
      <button className="outline" disabled={blocked || !canApply} onClick={() => onApply(record)}>Copy candidates into manual review</button>
      <p className="muted">Review the counts below and confirm them yourself. The interpretation record is included with exported evidence.</p>
    </div>}
  </section>;
}

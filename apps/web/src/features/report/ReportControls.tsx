import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { fmt, htmlLang, useI18n } from '../../i18n';
import type { Lang } from '../../i18n';
import type { Dictionary } from '../../i18n/ja';
import { floorLabel } from '../../map/floors';
import type { OutageReport, StationGraph } from '../../routing/types';
import { devicesOutOfService, indexDevices } from './devices';
import type { Device } from './devices';
import { ReportError } from './source';
import type { CommunityStatus, ReportErrorCode } from './source';

export type SendReport = (edgeId: string, status: CommunityStatus) => void;

/** "Elevator (ground to B2), near exit A1": floors in the direction of travel for escalators. */
export function deviceName(d: Device, t: Dictionary): string {
  const r = t.report;
  const name =
    d.mode === 'elevator'
      ? r.name.elevator
      : d.direction === 'up'
        ? r.name.escalatorUp
        : d.direction === 'down'
          ? r.name.escalatorDown
          : r.name.escalator;
  const [a, b] = d.direction === 'up' ? [d.bottomPanel, d.topPanel] : [d.topPanel, d.bottomPanel];
  const floors =
    a === b ? floorLabel(a, t) : fmt(r.floors, { a: floorLabel(a, t), b: floorLabel(b, t) });
  const named = fmt(r.named, { name, floors });
  return d.entrance ? fmt(r.near, { label: d.entrance, named }) : named;
}

/** Report times are shown in Tokyo time, whatever the device's time zone. */
export function reportTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(htmlLang[lang], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(iso));
}

type Feedback =
  { kind: 'sent'; status: CommunityStatus } | { kind: 'error'; code: ReportErrorCode } | null;

/** Sends reports and keeps the outcome for <ReportFeedback>. */
export function useReporter(report: (edgeId: string, status: CommunityStatus) => Promise<unknown>) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  const send = useCallback<SendReport>(
    (edgeId, status) => {
      setBusy(true);
      report(edgeId, status).then(
        () => {
          setFeedback({ kind: 'sent', status });
          setBusy(false);
        },
        (e: unknown) => {
          setFeedback({ kind: 'error', code: e instanceof ReportError ? e.code : 'failed' });
          setBusy(false);
        },
      );
    },
    [report],
  );

  return { send, busy, feedback };
}

/**
 * The outcome of the last report. Always in the page, so screen readers announce changes. The
 * focus moves here after a report, because the control that was used may disappear when the
 * route changes.
 */
export function ReportFeedback({ feedback, busy }: { feedback: Feedback; busy: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (feedback) ref.current?.focus();
  }, [feedback]);
  const { t } = useI18n();
  const r = t.report;
  const text = busy
    ? r.sending
    : feedback?.kind === 'sent'
      ? feedback.status === 'out_of_service'
        ? r.thanksOut
        : r.thanksWorking
      : feedback?.kind === 'error'
        ? r.errors[feedback.code]
        : '';
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="status"
      className={text ? 'notice-inline report-feedback' : 'report-feedback'}
      data-kind={busy ? 'sending' : (feedback?.kind ?? 'none')}
    >
      {text}
    </p>
  );
}

/**
 * Two taps: "Report a problem", then "Not working" or "Working". Escape or "Cancel" closes the
 * choice and returns the focus to the first button.
 */
export function StepReport({
  mode,
  stepNumber,
  busy,
  onSend,
}: {
  mode: Device['mode'];
  stepNumber: number;
  busy: boolean;
  onSend: (status: CommunityStatus) => void;
}) {
  const { t } = useI18n();
  const r = t.report;
  const uid = useId();
  const [open, setOpen] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    openRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const choose = (status: CommunityStatus) => {
    setOpen(false);
    onSend(status);
  };

  return (
    <>
      <button
        ref={openRef}
        type="button"
        className="step-button report-open"
        aria-expanded={open}
        aria-controls={`${uid}-choice`}
        aria-label={fmt(r.openLabel, { n: stepNumber, device: r.device[mode] })}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {r.open}
      </button>
      <div
        id={`${uid}-choice`}
        role="group"
        aria-labelledby={`${uid}-q`}
        className="report-choice"
        hidden={!open}
      >
        <p id={`${uid}-q`}>{fmt(r.question, { device: r.device[mode] })}</p>
        <button
          ref={firstRef}
          type="button"
          className="step-button report-out"
          disabled={busy}
          onKeyDown={onKeyDown}
          onClick={() => {
            choose('out_of_service');
          }}
        >
          {r.outOfService}
        </button>
        <button
          type="button"
          className="step-button report-working"
          disabled={busy}
          onKeyDown={onKeyDown}
          onClick={() => {
            choose('working');
          }}
        >
          {r.working}
        </button>
        <button type="button" className="step-button" onKeyDown={onKeyDown} onClick={close}>
          {r.cancel}
        </button>
      </div>
    </>
  );
}

/**
 * The station's devices reported out of service, with "still not working" and "working again".
 * Once a device is reported, routes avoid it, so this list is where it can be cleared.
 */
export function OutageList({
  graph,
  reports,
  busy,
  onSend,
}: {
  graph: StationGraph;
  reports: readonly OutageReport[];
  busy: boolean;
  onSend: SendReport;
}) {
  const { t, lang } = useI18n();
  const r = t.report;
  const uid = useId();
  const index = useMemo(() => indexDevices(graph), [graph]);
  const items = useMemo(() => devicesOutOfService(index, reports), [index, reports]);

  return (
    <section aria-labelledby={`${uid}-title`} className="outages">
      <h3 id={`${uid}-title`}>{r.listTitle}</h3>
      {items.length === 0 ? (
        <p>{r.none}</p>
      ) : (
        <>
          <p>{r.listIntro}</p>
          <ul className="outage-list">
            {items.map(({ device, report }, i) => (
              <li key={device.id} data-device={device.id}>
                <span id={`${uid}-${i}`}>{deviceName(device, t)}</span>
                <span className="step-note">
                  {fmt(r.reported, {
                    time: reportTime(report.createdAt, lang),
                    n: report.confirmations,
                  })}
                </span>
                <div className="step-actions">
                  <button
                    type="button"
                    className="step-button"
                    aria-describedby={`${uid}-${i}`}
                    disabled={busy}
                    onClick={() => {
                      onSend(report.edgeId, 'out_of_service');
                    }}
                  >
                    {r.stillBroken}
                  </button>
                  <button
                    type="button"
                    className="step-button"
                    aria-describedby={`${uid}-${i}`}
                    disabled={busy}
                    onClick={() => {
                      onSend(report.edgeId, 'working');
                    }}
                  >
                    {r.fixed}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

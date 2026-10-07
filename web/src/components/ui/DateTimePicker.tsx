import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { toLocalInput } from '../../utils/format';
import { cn } from '../../utils/cn';
import { inputCls } from './Modal';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  clearable?: boolean;
  className?: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (value: number) => String(value).padStart(2, '0');

function parseValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asLocalValue(date: Date): string {
  return toLocalInput(Math.floor(date.getTime() / 1000));
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** A theme-matched calendar and clock for the dates Orbit lets you edit. */
export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Choose date and time',
  title,
  clearable = false,
  className,
}: Props) {
  const selected = parseValue(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthStart(selected ?? new Date()));
  const [pickerDate, setPickerDate] = useState(() => selected ?? new Date());
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const today = new Date();
  const daysFromMonday = (month.getDay() + 6) % 7;
  const firstVisible = new Date(month.getFullYear(), month.getMonth(), 1 - daysFromMonday);
  const days = Array.from({ length: 42 }, (_, index) =>
    new Date(firstVisible.getFullYear(), firstVisible.getMonth(), firstVisible.getDate() + index),
  );
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shownValue = selected?.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', closeWhenOutside);
    return () => window.removeEventListener('pointerdown', closeWhenOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const placePanel = () => {
      const anchor = root.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(288, window.innerWidth - 32);
      const left = Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16));
      const estimatedHeight = 440;
      const below = anchor.bottom + 8;
      const top = below + estimatedHeight <= window.innerHeight - 12
        ? below
        : Math.max(12, anchor.top - estimatedHeight - 8);
      setPosition({ left, top, width });
    };
    placePanel();
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', placePanel, true);
    return () => {
      window.removeEventListener('resize', placePanel);
      window.removeEventListener('scroll', placePanel, true);
    };
  }, [open]);

  const showPicker = () => {
    const initial = parseValue(value) ?? new Date();
    setPickerDate(initial);
    setMonth(monthStart(initial));
    setOpen((current) => !current);
  };

  const chooseDay = (day: Date) => {
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      pickerDate.getHours(),
      pickerDate.getMinutes(),
      0,
      0,
    );
    setPickerDate(next);
    setMonth(monthStart(next));
    onChange(asLocalValue(next));
  };

  const chooseTime = (time: string) => {
    if (!time) return;
    const [hours, minutes] = time.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
    const next = new Date(pickerDate);
    next.setHours(hours, minutes, 0, 0);
    setPickerDate(next);
    if (selected) onChange(asLocalValue(next));
  };

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={showPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={shownValue ? `Date and time: ${shownValue}` : placeholder}
        title={title ?? 'Choose a date and time'}
        className={cn(inputCls, 'flex min-h-10 items-center justify-between gap-3 text-left', !shownValue && 'text-muted', className)}
      >
        <span className="min-w-0 truncate">{shownValue ?? placeholder}</span>
        <CalendarDays className="size-4 shrink-0 text-accent" aria-hidden />
      </button>

      {open && position && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="Choose date and time"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
            }
          }}
          style={{ left: position.left, top: position.top, width: position.width }}
          className="fixed z-[70] rounded-2xl border border-line bg-panel p-3 shadow-2xl shadow-black/40"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              aria-label="Previous month"
              className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-panel2 hover:text-fg"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold capitalize">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              aria-label="Next month"
              className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-panel2 hover:text-fg"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday} className="py-1 text-[10px] font-medium text-muted" aria-hidden>
                {weekday}
              </span>
            ))}
            {days.map((day) => {
              const inMonth = day.getMonth() === month.getMonth();
              const isSelected = selected !== null && dateKey(day) === dateKey(selected);
              const isToday = dateKey(day) === dateKey(today);
              return (
                <button
                  key={dateKey(day)}
                  type="button"
                  onClick={() => chooseDay(day)}
                  aria-label={day.toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  aria-pressed={isSelected}
                  className={cn(
                    'grid aspect-square place-items-center rounded-lg text-xs tabular-nums transition',
                    isSelected
                      ? 'bg-accent font-semibold text-bg shadow-sm'
                      : isToday
                        ? 'border border-accent/50 text-accent hover:bg-accent/10'
                        : 'text-fg hover:bg-panel2',
                    !inMonth && !isSelected && 'text-muted/55',
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-line/70 pt-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs text-muted focus-within:border-accent">
              <Clock3 className="size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="sr-only">Time</span>
              <input
                type="time"
                value={`${pad(pickerDate.getHours())}:${pad(pickerDate.getMinutes())}`}
                onChange={(event) => chooseTime(event.target.value)}
                aria-label="Time"
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => chooseDay(new Date())}
              className="rounded-lg border border-line px-2.5 py-2 text-xs text-muted transition hover:border-accent hover:text-fg"
            >
              Today
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-line/70 pt-2">
            {clearable ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                disabled={!value}
                className="rounded-lg px-2 py-1.5 text-xs text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear date
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25"
            >
              Done
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

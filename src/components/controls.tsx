import { useId, type ReactNode } from 'react';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  const { label, value, min, max, step, onChange, format } = props;
  return (
    <div className="control slider">
      <label htmlFor={id}>
        <span>{label}</span>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="control toggle">
      <input id={id} type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <label htmlFor={id}>
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </label>
    </div>
  );
}

export function Select<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="control select">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Panel(props: { title: string; children: ReactNode; open?: boolean; id?: string }) {
  return (
    <details className="panel" open={props.open} id={props.id}>
      <summary>{props.title}</summary>
      <div className="panel-body">{props.children}</div>
    </details>
  );
}

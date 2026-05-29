import { useEffect, useMemo, useRef, useState } from "react";

type Option = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
};

const findFirstEnabled = (options: Option[]) =>
  options.findIndex((opt) => !opt.disabled);

const findNextEnabled = (options: Option[], start: number, delta: number) => {
  if (options.length === 0) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const idx = (start + step * delta + options.length) % options.length;
    if (!options[idx].disabled) return idx;
  }
  return start;
};

const findMatch = (options: Option[], query: string, start: number) => {
  if (!query) return -1;
  const normalized = query.toLowerCase();
  const total = options.length;
  for (let offset = 0; offset < total; offset += 1) {
    const idx = (start + offset) % total;
    const opt = options[idx];
    if (opt.disabled) continue;
    if (opt.label.toLowerCase().startsWith(normalized)) return idx;
  }
  return -1;
};

export default function CustomSelect({
  value,
  options,
  onChange,
  placeholder,
  className,
  buttonClassName,
  menuClassName,
  ariaLabel
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const typeBufferRef = useRef("");
  const typeTimerRef = useRef<number | null>(null);

  const listId = useMemo(
    () => `custom-select-${Math.random().toString(36).slice(2, 9)}`,
    []
  );

  const selectedIndex = useMemo(
    () => options.findIndex((opt) => opt.value === value),
    [options, value]
  );

  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const label = selectedOption?.label ?? placeholder ?? "";

  useEffect(() => {
    if (open) return;
    const next = selectedIndex >= 0 ? selectedIndex : findFirstEnabled(options);
    setActiveIndex(next);
  }, [open, selectedIndex, options]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = document.getElementById(`${listId}-opt-${activeIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  const selectIndex = (idx: number) => {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const openAndMove = (delta: number) => {
    setOpen(true);
    setActiveIndex((current) => {
      const start = current >= 0 ? current : Math.max(selectedIndex, 0);
      return findNextEnabled(options, start, delta);
    });
  };

  const handleTypeahead = (key: string) => {
    if (!key || key.length !== 1) return;
    if (typeTimerRef.current) window.clearTimeout(typeTimerRef.current);
    typeBufferRef.current += key.toLowerCase();
    typeTimerRef.current = window.setTimeout(() => {
      typeBufferRef.current = "";
    }, 400);
    const start = activeIndex >= 0 ? activeIndex + 1 : Math.max(selectedIndex, 0);
    const matchIndex = findMatch(options, typeBufferRef.current, start);
    if (matchIndex >= 0) {
      setOpen(true);
      setActiveIndex(matchIndex);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        openAndMove(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        openAndMove(-1);
        break;
      case "Home":
        event.preventDefault();
        setOpen(true);
        setActiveIndex(findFirstEnabled(options));
        break;
      case "End":
        event.preventDefault();
        setOpen(true);
        setActiveIndex(findNextEnabled(options, options.length - 1, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!open) {
          setOpen(true);
        } else if (activeIndex >= 0) {
          selectIndex(activeIndex);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
      default:
        handleTypeahead(event.key);
    }
  };

  const rootClasses = ["custom-select", className].filter(Boolean).join(" ");
  const buttonClasses = ["custom-select__button", buttonClassName].filter(Boolean).join(" ");
  const menuClasses = ["custom-select__menu", menuClassName].filter(Boolean).join(" ");

  return (
    <div className={rootClasses} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClasses}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
      >
        <span className="custom-select__value">{label}</span>
      </button>
      {open && (
        <div className={menuClasses} role="listbox" id={listId}>
          {options.map((opt, idx) => (
            <div
              key={opt.value}
              id={`${listId}-opt-${idx}`}
              role="option"
              aria-selected={idx === selectedIndex}
              aria-disabled={opt.disabled ? true : undefined}
              className={[
                "custom-select__option",
                idx === activeIndex ? "custom-select__option--active" : "",
                idx === selectedIndex ? "custom-select__option--selected" : "",
                opt.disabled ? "custom-select__option--disabled" : ""
              ].filter(Boolean).join(" ")}
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => selectIndex(idx)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

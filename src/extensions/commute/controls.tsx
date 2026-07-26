import { useEffect, useId, useRef, useState } from "react";
import {
  searchAddresses,
  type AddressSelection,
} from "../../core/address-search";
import type { ControlProps } from "../api";

export interface CommuteFilterState {
  address?: AddressSelection;
  minutes: number;
}

export interface CommuteHeatmapState {
  address?: AddressSelection;
}

function AddressPicker({
  address,
  onChange,
  disabled,
  proximity,
}: {
  address?: AddressSelection;
  onChange: (address: AddressSelection | undefined) => void;
  disabled: boolean;
  proximity: [number, number];
}) {
  const listId = useId();
  const requestSequence = useRef(0);
  const [query, setQuery] = useState(address?.address ?? "");
  const [suggestions, setSuggestions] = useState<AddressSelection[]>([]);
  const [message, setMessage] = useState<string>();
  const [searching, setSearching] = useState(false);
  const proximityLongitude = proximity[0];
  const proximityLatitude = proximity[1];
  const normalizedQuery = query.trim();
  const addressIsValid =
    address !== undefined && normalizedQuery === address.address;
  const addressIsInvalid = normalizedQuery.length > 0 && !addressIsValid;

  useEffect(() => {
    if (address && query !== address.address) setQuery(address.address);
  }, [address, query]);

  useEffect(() => {
    const normalized = query.trim();
    if (address && normalized === address.address) {
      setSuggestions([]);
      setMessage(undefined);
      setSearching(false);
      return;
    }
    if (normalized.length < 3) {
      setSuggestions([]);
      setMessage(
        normalized.length > 0
          ? "Type at least 3 characters to search."
          : undefined,
      );
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      const sequence = ++requestSequence.current;
      setSearching(true);
      setMessage(undefined);
      try {
        const results = await searchAddresses(
          normalized,
          controller.signal,
          proximity,
        );
        if (sequence !== requestSequence.current) return;
        setSuggestions(results);
        setMessage(
          results.length === 0
            ? "No matching addresses found. Try a fuller address."
            : undefined,
        );
      } catch (error) {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setSuggestions([]);
        setMessage(
          error instanceof Error ? error.message : "Address lookup failed.",
        );
      } finally {
        if (sequence === requestSequence.current) setSearching(false);
      }
    }, 320);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [address, proximityLatitude, proximityLongitude, query]);

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-600">
        Address
        <span className="relative mt-1.5 block">
          <input
            aria-label="Commute address"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={suggestions.length > 0}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-8 text-xs text-slate-800 shadow-sm focus:border-red-400 focus:ring-2 focus:ring-red-100 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
            disabled={disabled}
            placeholder="Start typing an address"
            type="text"
            value={query}
            onChange={(event) => {
              const nextQuery = event.currentTarget.value;
              setQuery(nextQuery);
              setSuggestions([]);
              setMessage(undefined);
              if (address) onChange(undefined);
            }}
          />
          {searching ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 right-3 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-red-500"
            />
          ) : addressIsValid ? (
            <span
              aria-label="Valid address"
              className="absolute top-1/2 right-2.5 grid size-4 -translate-y-1/2 place-items-center rounded-full bg-emerald-500 text-white"
              role="img"
            >
              <svg
                aria-hidden="true"
                className="size-2.5"
                fill="none"
                viewBox="0 0 12 12"
              >
                <path
                  d="m2.25 6.25 2.25 2.25 5.25-5.25"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.75"
                />
              </svg>
            </span>
          ) : addressIsInvalid ? (
            <span
              aria-label="Invalid address"
              className="absolute top-1/2 right-2.5 grid size-4 -translate-y-1/2 place-items-center rounded-full bg-red-500 text-white"
              role="img"
            >
              <svg
                aria-hidden="true"
                className="size-2.5"
                fill="none"
                viewBox="0 0 12 12"
              >
                <path
                  d="m3.25 3.25 5.5 5.5m0-5.5-5.5 5.5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.75"
                />
              </svg>
            </span>
          ) : null}
        </span>
      </label>
      {suggestions.length > 0 ? (
        <ul
          className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          id={listId}
          role="listbox"
        >
          {suggestions.map((suggestion) => (
            <li
              key={`${suggestion.address}-${suggestion.center.join(",")}`}
              role="option"
              aria-selected={false}
            >
              <button
                className="w-full px-3 py-2 text-left text-[11px] leading-4 text-slate-700 hover:bg-red-50 focus:bg-red-50 focus:outline-none"
                type="button"
                onClick={() => {
                  setQuery(suggestion.address);
                  setSuggestions([]);
                  setMessage(undefined);
                  onChange(suggestion);
                }}
              >
                {suggestion.address}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? (
        <p className="text-[11px] leading-4 text-slate-500" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function CommuteFilterControls({
  value,
  onChange,
  disabled,
  loading,
  viewport,
}: ControlProps<CommuteFilterState>) {
  const [minutes, setMinutes] = useState(value.minutes);
  const committedMinutes = useRef(value.minutes);

  useEffect(() => {
    committedMinutes.current = value.minutes;
    setMinutes(value.minutes);
  }, [value.minutes]);

  const commitMinutes = (nextMinutes: number) => {
    if (nextMinutes === committedMinutes.current) return;
    committedMinutes.current = nextMinutes;
    onChange({ ...value, minutes: nextMinutes });
  };

  return (
    <div className="space-y-4">
      <AddressPicker
        address={value.address}
        disabled={disabled}
        proximity={viewport.center}
        onChange={(address) => onChange({ ...value, address })}
      />
      <label className="block text-xs text-slate-600">
        <span className="mb-2 flex items-center justify-between font-medium">
          Commute time
          <output className="rounded-md bg-red-50 px-2 py-0.5 font-semibold text-red-700">
            {minutes} min
          </output>
        </span>
        <input
          aria-label="Commute time"
          className="h-2 w-full cursor-pointer accent-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || loading}
          max="60"
          min="5"
          step="5"
          type="range"
          value={minutes}
          onChange={(event) => setMinutes(Number(event.currentTarget.value))}
          onBlur={(event) =>
            commitMinutes(Number(event.currentTarget.value))
          }
          onKeyUp={(event) =>
            commitMinutes(Number(event.currentTarget.value))
          }
          onPointerCancel={(event) =>
            commitMinutes(Number(event.currentTarget.value))
          }
          onPointerUp={(event) =>
            commitMinutes(Number(event.currentTarget.value))
          }
        />
      </label>
    </div>
  );
}

export function CommuteHeatmapControls({
  value,
  onChange,
  disabled,
  viewport,
}: ControlProps<CommuteHeatmapState>) {
  return (
    <AddressPicker
      address={value.address}
      disabled={disabled}
      proximity={viewport.center}
      onChange={(address) => onChange({ address })}
    />
  );
}

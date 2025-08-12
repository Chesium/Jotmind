import React from "react";
import { useEntities } from "~/store/useEntities";

export default function SearchBar() {
  // const { query, setQuery, runSearch, suggestions } = useSearchStore();
  const { setQuery, runSearch, query, suggestions } = useEntities();

  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setOpen(true);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch();
    setOpen(false);
  };

  const pick = (text: string) => {
    setQuery(text);
    runSearch();
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <form onSubmit={onSubmit} className="relative w-full max-w-xl">
      <input
        ref={inputRef}
        value={query}
        onChange={onChange}
        placeholder="Search entities or claims…"
        className="w-full rounded-lg border px-3 py-2"
      />
      <button type="submit" className="absolute right-1 top-1.5 px-3 py-1 rounded-md bg-black text-white text-sm">
        Search
      </button>

      {open && query && suggestions.length > 0 && (
        <div className="z-100 mt-1 w-full rounded-lg border bg-white shadow">
          {suggestions.slice(0, 8).map((sug, i) => (
            <button
              key={i}
              type="button"
              onClick={() => pick(sug.suggestion)}
              className="block w-full text-left px-3 py-2 hover:bg-gray-50"
            >
              {sug.suggestion}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
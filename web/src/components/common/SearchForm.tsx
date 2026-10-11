import { useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export function SearchForm({
  initialValue,
  onSearch,
}: {
  initialValue: string;
  onSearch: (query: string) => void;
}) {
  const [search, setSearch] = useState({ applied: initialValue, draft: initialValue });
  // A changed URL value (including Back/Forward) resets the draft without
  // replacing the input. Unrelated query refreshes must preserve edits/focus.
  if (search.applied !== initialValue) {
    setSearch({ applied: initialValue, draft: initialValue });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(search.draft.trim());
  }
  return (
    <form className="search-form" onSubmit={submit} role="search">
      <label>
        <span className="sr-only">搜索机构名称或别名</span>
        <Input
          name="q"
          type="search"
          value={search.draft}
          onChange={(event) =>
            setSearch({ applied: initialValue, draft: event.currentTarget.value })
          }
          placeholder="机构名称或别名"
          maxLength={100}
        />
      </label>
      <Button type="submit">
        查询档案 <span aria-hidden="true">↗</span>
      </Button>
    </form>
  );
}

import { useState, useEffect } from 'react';

// Keeps a fast-changing value (a search box, typically) from driving a network
// request on every keystroke. The raw value stays in the input for
// responsiveness; the debounced one goes into the query key.
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default useDebounced;

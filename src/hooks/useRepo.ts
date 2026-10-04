import { useSyncExternalStore } from 'react';
import { getState, subscribe, RepoState } from '../services/repo';

// Subscribes a component to the data store.
export function useRepo(): RepoState {
  return useSyncExternalStore(subscribe, getState, getState);
}

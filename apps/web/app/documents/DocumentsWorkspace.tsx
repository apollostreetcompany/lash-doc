'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import styles from './page.module.css';
import { Icon } from '../../components/shell/Icon';
import { documentWorkspacePath } from '../../lib/documentNavigation';
import {
  createNewDocumentId,
  DOCUMENT_REGISTRY_STORAGE_KEY,
  listDocuments,
  upsertDocument,
  type LashDocumentRecord,
} from '../../lib/documentRegistry';

const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const searchText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const activityTime = (value: string) => Date.parse(value) || 0;

export function DocumentsWorkspace({ staticPreview = false }: { staticPreview?: boolean }) {
  const router = useRouter();
  const searchInput = useRef<HTMLInputElement>(null);
  const [registry, setRegistry] = useState<LashDocumentRecord[] | 'unavailable' | null>(null);
  const [query, setQuery] = useState('');
  const [createError, setCreateError] = useState(false);
  const [navigating, startNavigation] = useTransition();

  useEffect(() => {
    const refresh = () => {
      try {
        setRegistry(
          listDocuments(window.localStorage).sort(
            (left, right) => activityTime(right.updatedAt) - activityTime(left.updatedAt),
          ),
        );
      } catch {
        setRegistry('unavailable');
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === DOCUMENT_REGISTRY_STORAGE_KEY ||
        event.key.startsWith('lash:title:')
      ) {
        refresh();
      }
    };

    refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', refresh);
    };
  }, []);

  const createDocument = () => {
    const id = createNewDocumentId();
    try {
      upsertDocument(window.localStorage, { id });
    } catch {
      setCreateError(true);
      return;
    }
    setCreateError(false);
    const path = documentWorkspacePath(id, staticPreview);
    startNavigation(() => {
      if (staticPreview) window.location.assign(path);
      else router.push(path as Route);
    });
  };

  const normalizedQuery = searchText(query);
  const available = Array.isArray(registry);
  const matches = available
    ? registry.filter(({ title }) => searchText(title).includes(normalizedQuery))
    : [];

  return (
    <div className={styles.workspace}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Link href="/" className={styles.brand} aria-label="Lash writing workspace">
            <span className="lash-sidebar-logo" aria-hidden="true">
              L
            </span>
            Lash
          </Link>
        </div>
      </header>
      <main className={styles.main} aria-labelledby="documents-title">
        <div className={styles.heading}>
          <div>
            <h1 id="documents-title">Documents</h1>
            <p>In this browser</p>
          </div>
          <button
            className={styles.create}
            type="button"
            disabled={registry === null || navigating}
            onClick={createDocument}
          >
            <Icon name="plus" />
            New document
          </button>
        </div>

        {createError ? (
          <p className={styles.notice} role="alert">
            Couldn’t create a document in this browser. Try again.
          </p>
        ) : null}

        {available ? (
          <div className={styles.search}>
            <label htmlFor="document-search">Search by title</label>
            <input
              ref={searchInput}
              id="document-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}

        <div aria-busy={registry === null}>
          {registry === null ? <p className={styles.notice}>Loading documents…</p> : null}
          {registry === 'unavailable' ? (
            <p className={styles.notice} role="alert">
              Couldn’t load the documents in this browser.
            </p>
          ) : null}
          <p role="status" className="sr-only">
            {available && normalizedQuery
              ? `${matches.length} ${matches.length === 1 ? 'document' : 'documents'} found`
              : ''}
          </p>
          {available && matches.length === 0 ? (
            <div className={styles.notice}>
              <p>No documents match your search.</p>
              <button
                className={styles.clear}
                type="button"
                onClick={() => {
                  setQuery('');
                  searchInput.current?.focus();
                }}
              >
                Clear search
              </button>
            </div>
          ) : null}
          {matches.length > 0 ? (
            <ul className={styles.documents} aria-label="Documents, most recent first">
              {matches.map(({ id, title, updatedAt }) => {
                const time = activityTime(updatedAt);
                return (
                  <li key={id}>
                    <Link
                      className={styles.document}
                      href={documentWorkspacePath(id, staticPreview) as Route}
                      prefetch={false}
                    >
                      <Icon name="document" className={styles.documentIcon} />
                      <span className={styles.documentTitle}>{title}</span>
                      {time ? (
                        <time className={styles.documentTime} dateTime={updatedAt}>
                          {formatDate.format(time)}
                        </time>
                      ) : null}
                      <Icon name="chevron-right" className={styles.chevron} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </main>
    </div>
  );
}

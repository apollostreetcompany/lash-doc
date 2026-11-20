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
const PAGE_SIZE = 50;
type LibraryDocument = LashDocumentRecord & { time: number; searchTitle: string };

export function DocumentsWorkspace({ staticPreview = false }: { staticPreview?: boolean }) {
  const router = useRouter();
  const searchInput = useRef<HTMLInputElement>(null);
  const [registry, setRegistry] = useState<LibraryDocument[] | 'unavailable' | null>(null);
  const [{ query, limit }, setSearch] = useState({ query: '', limit: PAGE_SIZE });
  const nextResultFocus = useRef<string | null>(null);
  const [createError, setCreateError] = useState(false);
  const [navigating, startNavigation] = useTransition();

  useEffect(() => {
    const refresh = () => {
      try {
        setRegistry(
          listDocuments(window.localStorage)
            .map((record) => ({
              ...record,
              time: activityTime(record.updatedAt),
              searchTitle: searchText(record.title),
            }))
            .sort((left, right) => right.time - left.time),
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

    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  useEffect(() => {
    if (nextResultFocus.current) {
      document.getElementById(nextResultFocus.current)?.focus();
      nextResultFocus.current = null;
    }
  }, [limit]);

  const search = (value: string) => {
    nextResultFocus.current = null;
    setSearch({ query: value, limit: PAGE_SIZE });
  };

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
  const records = available ? registry : [];
  const matches = normalizedQuery
    ? records.filter(({ searchTitle }) => searchTitle.includes(normalizedQuery))
    : records;

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
              onChange={(event) => search(event.target.value)}
            />
          </div>
        ) : null}

        <div aria-busy={registry === null}>
          {registry === null ? <p className={styles.notice}>Loading documents…</p> : null}
          {registry === 'unavailable' ? (
            <p className={styles.notice} role="alert">
              Couldn’t load the documents in this browser. If you have a document link, try opening
              it directly.
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
                  search('');
                  searchInput.current?.focus();
                }}
              >
                Clear search
              </button>
            </div>
          ) : null}
          {matches.length > 0 ? (
            <ul className={styles.documents} aria-label="Documents, most recent first">
              {matches.slice(0, limit).map(({ id, title, updatedAt, time }) => {
                return (
                  <li key={id}>
                    <Link
                      id={`library-link-${id}`}
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
          {matches.length > limit ? (
            <button
              className={styles.more}
              type="button"
              onClick={() => {
                nextResultFocus.current = `library-link-${matches[limit].id}`;
                setSearch({ query, limit: limit + PAGE_SIZE });
              }}
            >
              Show more documents
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}

'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { flushSync } from 'react-dom';

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
import { NAMED_EDIT_ROOM_ID } from '../../lib/namedEdit/contract';
import {
  watchRecentSharedDocuments,
  type RecentSharedDocuments,
} from '../../lib/recentSharedDocuments';

const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const searchText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const activityTime = (value: string) => Date.parse(value) || 0;
const PAGE_SIZE = 50;
type LibraryDocument = LashDocumentRecord & { time: number; searchTitle: string };

export function DocumentsWorkspace({ staticPreview = false }: { staticPreview?: boolean }) {
  const router = useRouter();
  const searchInput = useRef<HTMLInputElement>(null);
  const documentsHeading = useRef<HTMLHeadingElement>(null);
  const [registry, setRegistry] = useState<LibraryDocument[] | 'unavailable' | null>(null);
  const [recentShared, setRecentShared] = useState<RecentSharedDocuments>({ kind: 'pending' });
  const sharedObserver = useRef<ReturnType<typeof watchRecentSharedDocuments> | null>(null);
  const [{ query, limit }, setSearch] = useState({ query: '', limit: PAGE_SIZE });
  const nextResultFocus = useRef<string | null>(null);
  const [createError, setCreateError] = useState(false);
  const [navigating, startNavigation] = useTransition();

  useEffect(() => {
    const refresh = () => {
      try {
        setRegistry(
          listDocuments(window.localStorage)
            .filter(({ id }) => staticPreview || !NAMED_EDIT_ROOM_ID.test(id))
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
  }, [staticPreview]);

  useEffect(() => {
    if (staticPreview) return;
    const observer = watchRecentSharedDocuments((state, immediate) => {
      if (immediate) flushSync(() => setRecentShared(state));
      else setRecentShared(state);
    });
    sharedObserver.current = observer;
    return () => {
      sharedObserver.current = null;
      observer.dispose();
    };
  }, [staticPreview]);

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
  const shared = !staticPreview && recentShared.kind === 'ready' ? recentShared.documents : [];
  const sharedMatches = normalizedQuery
    ? shared.filter(({ title }) => searchText(title).includes(normalizedQuery))
    : shared;
  const checkingShared = !staticPreview && recentShared.kind === 'checking';
  const waitingForShared = !staticPreview && (recentShared.kind === 'pending' || checkingShared);
  const sharedUnavailable = !staticPreview && recentShared.kind === 'unavailable';
  const reconnectShared = !staticPreview && recentShared.kind === 'reconnect' ? recentShared : null;
  const matchCount = matches.length + sharedMatches.length;
  const searchComplete =
    registry !== null && !waitingForShared && !sharedUnavailable && !reconnectShared;
  const resultNoun = available ? 'document' : 'shared document';
  const canReportMatches = searchComplete && normalizedQuery && (available || shared.length > 0);

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
            <h1 id="documents-title" ref={documentsHeading} tabIndex={-1}>
              Documents
            </h1>
            {staticPreview ? <p>In this browser</p> : null}
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

        {available || shared.length > 0 || waitingForShared || normalizedQuery ? (
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

        <div>
          {registry === null ? <p className={styles.notice}>Loading documents…</p> : null}
          {registry === 'unavailable' ? (
            <p className={styles.notice} role="alert">
              Couldn’t load the documents in this browser. If you have a document link, try opening
              it directly.
            </p>
          ) : null}
          <p role="status" className="sr-only">
            {canReportMatches
              ? `${matchCount} ${resultNoun}${matchCount === 1 ? '' : 's'} found`
              : ''}
          </p>
          {canReportMatches && matchCount === 0 ? (
            <div className={styles.notice}>
              <p>
                {available
                  ? 'No documents match your search.'
                  : 'No shared documents match your search.'}
              </p>
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
          {checkingShared || sharedUnavailable || reconnectShared || sharedMatches.length > 0 ? (
            <section className={styles.librarySection} aria-labelledby="shared-documents-title">
              <h2 id="shared-documents-title">Recently shared</h2>
              {checkingShared ? (
                <p className={styles.notice} role="status">
                  Checking shared access…
                </p>
              ) : null}
              {sharedUnavailable || reconnectShared ? (
                <div className={styles.notice}>
                  {sharedUnavailable || reconnectShared?.failed ? (
                    <p role="status">
                      {sharedUnavailable
                        ? 'Couldn’t check shared documents.'
                        : 'Couldn’t reconnect to shared documents.'}
                    </p>
                  ) : null}
                  <button
                    className={styles.clear}
                    type="button"
                    onClick={() => {
                      const target = searchInput.current ?? documentsHeading.current;
                      target?.focus({ preventScroll: true });
                      if (reconnectShared) sharedObserver.current?.reconnect();
                      else sharedObserver.current?.retry();
                    }}
                  >
                    {reconnectShared ? 'Reconnect to shared documents' : 'Try again'}
                  </button>
                </div>
              ) : null}
              {sharedMatches.length > 0 ? (
                <ul className={styles.documents} aria-label="Recently shared documents">
                  {sharedMatches.map(({ id, title }) => (
                    <li key={id}>
                      <Link
                        className={styles.document}
                        href={documentWorkspacePath(id) as Route}
                        prefetch={false}
                      >
                        <Icon name="document" className={styles.documentIcon} />
                        <span className={styles.documentTitle}>{title}</span>
                        <Icon name="chevron-right" className={styles.chevron} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {matches.length > 0 ? (
            <section
              className={styles.librarySection}
              aria-labelledby={staticPreview ? undefined : 'device-drafts-title'}
            >
              {!staticPreview ? <h2 id="device-drafts-title">Device drafts</h2> : null}
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
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}

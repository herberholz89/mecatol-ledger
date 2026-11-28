import { isLikelyGamesTab } from '@mecatol/shared';
import { useState } from 'react';
import { FormError } from '../../components/form.js';
import type { LoadedFile } from './ImportPage.js';

/** Reads the file in the browser. Nothing is sent to the server until the last step. */
export function UploadStep({ onLoaded }: { onLoaded: (file: LoadedFile, likelyTabs: string[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function read(file: File) {
    setError(null);
    setReading(true);
    try {
      // SheetJS is large, so it's only loaded on this page.
      const { readSpreadsheet } = await import('@mecatol/shared/xlsx');
      const tabs = readSpreadsheet(await file.arrayBuffer(), file.name);
      if (tabs.length === 0) throw new Error('That file has no data.');
      onLoaded({ name: file.name, tabs }, tabs.filter(isLikelyGamesTab).map((t) => t.name));
    } catch (err) {
      setError(err instanceof Error ? `Couldn't read that file: ${err.message}` : "Couldn't read that file.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <label className="block cursor-pointer rounded-md border-2 border-dashed border-slate-300 p-8 text-center hover:border-indigo-400 dark:border-slate-700">
        <span className="block font-medium">{reading ? 'Reading…' : 'Choose a .xlsx or .csv file'}</span>
        <span className="mt-1 block text-sm text-slate-500">The file is read in your browser. Nothing is saved until you confirm the import.</span>
        <input
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="sr-only"
          disabled={reading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void read(file);
          }}
        />
      </label>
      <FormError message={error} />
      <div className="space-y-1 text-sm text-slate-500">
        <p>
          In Google Sheets, use <span className="font-medium">File → Download → Microsoft Excel (.xlsx)</span> to get every tab, or{' '}
          <span className="font-medium">Comma-separated values (.csv)</span> for the current tab only.
        </p>
        <p>
          Expected layout: one row per player (faction, player, score), a blank row between games, and an optional date or note in column H.
        </p>
      </div>
    </div>
  );
}

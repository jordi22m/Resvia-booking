import { useEffect, useMemo, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertCircle, Clock3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/lib/supabase';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type ImportCsvResponse = {
  job_id: string;
  rows_received: number;
  rows_inserted: number;
  chunks_processed: number;
  error?: string;
};

type ImportPreviewResponse = {
  job_id: string;
  total_rows: number;
  preview_rows: Array<Record<string, unknown>>;
  columns: string[];
  error?: string;
};

type ImportValidateRow = {
  row_number: number;
  is_valid: boolean;
  first_error: string | null;
  raw_payload: Record<string, unknown>;
};

type ImportValidateResponse = {
  job_id: string;
  summary: {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
  };
  rows: ImportValidateRow[];
  error?: string;
};

type ImportApplyResponse = {
  job_id: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  error?: string;
};

type ImportJobInfo = {
  id: string;
  status: string;
  total_rows: number;
  created_at: string;
};

const IMPORT_JOB_STORAGE_KEY = 'resvia_import_job_id';

function isValidDateValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }

  const asDate = new Date(String(value));
  return !Number.isNaN(asDate.getTime());
}

function validateRowLocally(rawPayload: Record<string, unknown>, rowNumber: number): ImportValidateRow {
  const errors: string[] = [];

  const name = rawPayload?.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Name is required and must be a string');
  }

  const phone = rawPayload?.phone;
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    errors.push('Phone is required');
  } else {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9) {
      errors.push('Phone must contain at least 9 digits');
    }
  }

  const date = rawPayload?.date;
  if (!isValidDateValue(date)) {
    errors.push('Date must be a valid date');
  }

  return {
    row_number: rowNumber,
    is_valid: errors.length === 0,
    first_error: errors[0] ?? null,
    raw_payload: rawPayload,
  };
}

function toInputValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function getJobStatusMeta(status?: string) {
  switch (status) {
    case 'importing':
      return {
        label: 'IMPORTING',
        className: 'bg-blue-100 text-blue-700 border-blue-200',
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      };
    case 'completed':
      return {
        label: 'COMPLETED',
        className: 'bg-green-100 text-green-700 border-green-200',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case 'failed':
      return {
        label: 'FAILED',
        className: 'bg-red-100 text-red-700 border-red-200',
        icon: <AlertCircle className="h-3.5 w-3.5" />,
      };
    case 'uploaded':
    default:
      return {
        label: (status || 'uploaded').toUpperCase(),
        className: 'bg-slate-100 text-slate-700 border-slate-200',
        icon: <Clock3 className="h-3.5 w-3.5" />,
      };
  }
}

export default function ImportCsvPage() {
  const { data: profile } = useProfile();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [validation, setValidation] = useState<ImportValidateResponse | null>(null);
  const [applyResult, setApplyResult] = useState<ImportApplyResponse | null>(null);

  const [uploading, setUploading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [jobInfo, setJobInfo] = useState<ImportJobInfo | null>(null);
  const [jobInfoLoading, setJobInfoLoading] = useState(false);

  const canUpload = Boolean(selectedFile) && Boolean(profile?.id) && !uploading;
  const canPreview = Boolean(jobId) && !previewLoading;
  const canValidate = Boolean(jobId) && !validating;
  const hasValidationExecuted = Boolean(validation);
  const validRowsCount = validation?.summary.valid_rows ?? 0;
  const canApply = hasValidationExecuted && validRowsCount > 0 && !applying;
  const invalidRowsCount = validation?.summary.invalid_rows ?? 0;

  const previewColumns = preview?.columns ?? [];

  const validationRowsForTable = useMemo(() => (validation?.rows ?? []).slice(0, 50), [validation]);
  const invalidRowsForTable = useMemo(
    () => validationRowsForTable.filter((row) => !row.is_valid),
    [validationRowsForTable],
  );
  const validRowsForTable = useMemo(
    () => validationRowsForTable.filter((row) => row.is_valid),
    [validationRowsForTable],
  );
  const statusMeta = useMemo(() => getJobStatusMeta(jobInfo?.status), [jobInfo?.status]);
  const formattedCreatedAt = useMemo(() => {
    if (!jobInfo?.created_at) return '-';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(jobInfo.created_at));
  }, [jobInfo?.created_at]);

  const fetchJobInfo = async (id: string) => {
    setJobInfoLoading(true);
    try {
      const { data, error } = await supabase
        .from('import_jobs')
        .select('id, status, total_rows, created_at')
        .eq('id', id)
        .single();

      if (error) throw error;
      setJobInfo(data as ImportJobInfo);
    } catch (err: unknown) {
      setJobInfo(null);
      setErrorMessage(err instanceof Error ? err.message : 'Error al cargar estado del job');
    } finally {
      setJobInfoLoading(false);
    }
  };

  useEffect(() => {
    const savedJobId = localStorage.getItem(IMPORT_JOB_STORAGE_KEY);
    if (savedJobId) {
      setJobId(savedJobId);
    }
  }, []);

  useEffect(() => {
    if (!jobId) {
      setJobInfo(null);
      localStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
      return;
    }

    localStorage.setItem(IMPORT_JOB_STORAGE_KEY, jobId);
    void fetchJobInfo(jobId);
  }, [jobId]);

  const resetDownstreamState = () => {
    setPreview(null);
    setValidation(null);
    setApplyResult(null);
  };

  const handleFile = (file: File | null) => {
    setSelectedFile(file);
    setJobId(null);
    setJobInfo(null);
    setStatusMessage('');
    setErrorMessage('');
    resetDownstreamState();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    handleFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !profile?.id) return;

    setUploading(true);
    setStatusMessage('Uploading...');
    setErrorMessage('');
    resetDownstreamState();

    try {
      const csvText = await selectedFile.text();
      const { data, error } = await supabase.functions.invoke('import-csv', {
        body: {
          business_id: profile.id,
          file_name: selectedFile.name,
          csv: csvText,
        },
      });

      if (error) throw error;

      const response = data as ImportCsvResponse;
      if (!response?.job_id) {
        throw new Error(response?.error || 'No se pudo crear el import job');
      }

      setJobId(response.job_id);
      localStorage.setItem(IMPORT_JOB_STORAGE_KEY, response.job_id);
      setStatusMessage(`Upload completed. Job: ${response.job_id}`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al subir CSV');
      setStatusMessage('');
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async () => {
    if (!jobId) return;

    setPreviewLoading(true);
    setStatusMessage('Loading preview...');
    setErrorMessage('');

    try {
      const { data, error } = await supabase.functions.invoke('import-preview', {
        body: { job_id: jobId },
      });

      if (error) throw error;

      const response = data as ImportPreviewResponse;
      if (response?.error) throw new Error(response.error);

      setPreview(response);
      setStatusMessage('Preview loaded');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al cargar preview');
      setStatusMessage('');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleValidate = async () => {
    if (!jobId) return;

    setValidating(true);
    setStatusMessage('Validating...');
    setErrorMessage('');

    try {
      const { data, error } = await supabase.functions.invoke('import-validate', {
        body: { job_id: jobId },
      });

      if (error) throw error;

      const response = data as ImportValidateResponse;
      if (response?.error) throw new Error(response.error);

      setValidation(response);
      setStatusMessage('Validation completed');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al validar');
      setStatusMessage('');
    } finally {
      setValidating(false);
    }
  };

  const handleApply = async () => {
    if (!jobId) return;

    setApplying(true);
    setStatusMessage('Importing valid data...');
    setErrorMessage('');

    try {
      const { data, error } = await supabase.functions.invoke('import-apply', {
        body: { job_id: jobId },
      });

      if (error) throw error;

      const response = data as ImportApplyResponse;
      if (response?.error) throw new Error(response.error);

      setApplyResult(response);
      setStatusMessage('Import completed');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al aplicar importación');
      setStatusMessage('');
    } finally {
      setApplying(false);
    }
  };

  const handleDownloadInvalidCsv = () => {
    if (!validation) return;

    const invalidRows = validation.rows.filter((row) => !row.is_valid);
    if (invalidRows.length === 0) return;

    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const headers = ['row_number', 'error_message', 'original_data'];

    const lines = [headers.join(',')];
    for (const row of invalidRows) {
      lines.push([
        String(row.row_number),
        escapeCsv(row.first_error ?? ''),
        escapeCsv(JSON.stringify(row.raw_payload ?? {})),
      ].join(','));
    }

    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `invalid_rows_${jobId ?? 'import'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleInvalidFieldChange = (
    rowNumber: number,
    field: 'name' | 'phone' | 'date',
    value: string,
  ) => {
    setValidation((prev) => {
      if (!prev) return prev;

      const updatedRows = prev.rows.map((row) => {
        if (row.row_number !== rowNumber) return row;

        return {
          ...row,
          raw_payload: {
            ...row.raw_payload,
            [field]: value,
          },
        };
      });

      return {
        ...prev,
        rows: updatedRows,
      };
    });
  };

  const handleRevalidateRow = (rowNumber: number) => {
    setValidation((prev) => {
      if (!prev) return prev;

      const updatedRows = prev.rows.map((row) => {
        if (row.row_number !== rowNumber) return row;
        return validateRowLocally(row.raw_payload ?? {}, row.row_number);
      });

      const validRows = updatedRows.filter((row) => row.is_valid).length;
      const invalidRows = updatedRows.length - validRows;

      return {
        ...prev,
        rows: updatedRows,
        summary: {
          ...prev.summary,
          total_rows: updatedRows.length,
          valid_rows: validRows,
          invalid_rows: invalidRows,
        },
      };
    });
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Importar CSV</h1>
        <p className="text-sm text-muted-foreground">Importa clientes y reservas en minutos.</p>
      </div>

      {jobId ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Import Job</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.className}`}>
                {statusMeta.icon}
                {jobInfoLoading ? 'LOADING...' : statusMeta.label}
              </span>
            </div>

            <div className="grid sm:grid-cols-3 gap-2">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Job ID</p>
                <p className="font-medium break-all">{jobId}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Total rows</p>
                <p className="font-medium">{jobInfo?.total_rows ?? '-'}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Created at</p>
                <p className="font-medium">{formattedCreatedAt}</p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => jobId && fetchJobInfo(jobId)}
              disabled={jobInfoLoading}
            >
              {jobInfoLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Refresh status
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Paso 1: Subir CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="rounded-lg border border-dashed p-6 text-center bg-muted/30"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Arrastra un archivo CSV aquí o selecciónalo manualmente</p>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </div>
          </div>

          {selectedFile && (
            <p className="text-sm text-muted-foreground">
              Archivo: <span className="font-medium text-foreground">{selectedFile.name}</span>
            </p>
          )}

          <Button onClick={handleUpload} disabled={!canUpload}>
            {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Subir CSV
          </Button>

          {jobId ? <p className="text-sm text-success">Job ID: {jobId}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paso 2: Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handlePreview} disabled={!canPreview} variant="outline">
            {previewLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Cargar preview
          </Button>

          {preview ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Total rows: {preview.total_rows}</p>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {previewColumns.map((col) => (
                        <TableHead key={col}>{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.preview_rows.map((row, i) => (
                      <TableRow key={i}>
                        {previewColumns.map((col) => (
                          <TableCell key={`${i}-${col}`}>{String(row[col] ?? '')}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paso 3: Validación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleValidate} disabled={!canValidate} variant="outline">
            {validating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Validar
          </Button>

          {validation ? (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-2 text-sm">
                <div className="rounded border p-2">Total: {validation.summary.total_rows}</div>
                <div className="rounded border p-2 text-success">Valid: {validation.summary.valid_rows}</div>
                <div className="rounded border p-2 text-destructive">Invalid: {validation.summary.invalid_rows}</div>
              </div>

              <div className="space-y-2">
                <Button onClick={handleApply} disabled={!canApply}>
                  {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  {applying ? 'Importing...' : 'Import valid data'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDownloadInvalidCsv}
                  disabled={invalidRowsCount === 0}
                >
                  Download invalid rows CSV
                </Button>
                {validRowsCount === 0 ? (
                  <p className="text-sm text-muted-foreground">No valid rows to import</p>
                ) : null}
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>First error</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invalidRowsForTable.map((row) => (
                      <TableRow key={row.row_number} className="bg-destructive/10">
                        <TableCell>{row.row_number}</TableCell>
                        <TableCell>
                          <Input
                            value={toInputValue(row.raw_payload?.name)}
                            onChange={(event) => handleInvalidFieldChange(row.row_number, 'name', event.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={toInputValue(row.raw_payload?.phone)}
                            onChange={(event) => handleInvalidFieldChange(row.row_number, 'phone', event.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={toInputValue(row.raw_payload?.date)}
                            onChange={(event) => handleInvalidFieldChange(row.row_number, 'date', event.target.value)}
                          />
                        </TableCell>
                        <TableCell>{row.first_error ?? '-'}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => handleRevalidateRow(row.row_number)}>
                            Revalidate row
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {invalidRowsForTable.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-sm text-muted-foreground">
                          No invalid rows in current view
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validRowsForTable.map((row) => (
                      <TableRow key={`valid-${row.row_number}`}>
                        <TableCell>{row.row_number}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" /> Válida</span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {validRowsForTable.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} className="text-sm text-muted-foreground">
                          No valid rows in current view
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>

              {applyResult ? (
                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  <div className="rounded border p-3 text-success">imported_rows: {applyResult.imported_rows}</div>
                  <div className="rounded border p-3 text-muted-foreground">skipped_rows: {applyResult.skipped_rows}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {statusMessage ? <p className="text-sm text-muted-foreground">{statusMessage}</p> : null}
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
    </div>
  );
}

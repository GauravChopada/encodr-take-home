"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@/lib/client/api";
import { useCreateJob } from "@/lib/client/hooks";
import { createJobSchema, type CreateJobInput } from "@/lib/schemas";

const inputClass = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm";
const FIELDS = ["sourceUrl", "title"] as const;

export function CreateJobForm() {
  const createJob = useCreateJob();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
    defaultValues: { sourceUrl: "", title: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createJob.mutateAsync(values);
      reset();
    } catch (e) {
      if (!(e instanceof ApiError)) {
        setFormError("Could not create the job. Check your connection and try again.");
        return;
      }
      // Map the server's per-field messages (422) onto the matching inputs; anything else is form-level.
      let mapped = false;
      for (const field of FIELDS) {
        const message = e.fieldErrors?.[field]?.[0];
        if (message) {
          setError(field, { type: "server", message });
          mapped = true;
        }
      }
      if (!mapped) setFormError(e.message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="sourceUrl" className="mb-1 block text-sm font-medium">
          Source URL
        </label>
        <input
          id="sourceUrl"
          {...register("sourceUrl")}
          className={inputClass}
          placeholder="https://cdn.example.com/videos/clip.mp4"
          aria-invalid={errors.sourceUrl ? true : undefined}
          aria-describedby={errors.sourceUrl ? "sourceUrl-error" : undefined}
        />
        {errors.sourceUrl && (
          <p id="sourceUrl-error" className="mt-1 text-xs text-red-600">
            {errors.sourceUrl.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          Title (optional)
        </label>
        <input
          id="title"
          {...register("title")}
          className={inputClass}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "title-error" : undefined}
        />
        {errors.title && (
          <p id="title-error" className="mt-1 text-xs text-red-600">
            {errors.title.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? "Creating..." : "Create job"}
      </button>
    </form>
  );
}

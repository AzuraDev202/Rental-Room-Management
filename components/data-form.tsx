"use client";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useState } from "react";
export type Field = {
  name: string;
  label: string;
  type?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  step?: number;
};
export function DataForm({
  schema,
  fields,
  defaults = {},
  submit,
  onSubmit,
  children,
}: {
  schema: z.ZodType;
  fields: Field[];
  defaults?: Record<string, unknown>;
  submit: string;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
  children?: React.ReactNode;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema) as Resolver<Record<string, unknown>>,
    defaultValues: defaults,
  });
  const [error, setError] = useState("");
  return (
    <form
      className="data-form"
      onSubmit={handleSubmit(async (values) => {
        setError("");
        try {
          await onSubmit(values);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Không thể lưu. Vui lòng thử lại.",
          );
        }
      })}
    >
      <fieldset disabled={isSubmitting}>
        <div className="form-grid">
          {fields.map((f) => (
            <div className="form-field" key={f.name}>
              <label htmlFor={"field-" + f.name}>{f.label}</label>
              {f.options ? (
                <select
                  id={"field-" + f.name}
                  aria-invalid={!!errors[f.name]}
                  aria-describedby={
                    errors[f.name] ? "error-" + f.name : undefined
                  }
                  {...register(f.name)}
                >
                  <option value="">Chọn...</option>
                  {f.options.map((o) => (
                    <option value={o.value} key={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={"field-" + f.name}
                  type={f.type || "text"}
                  min={f.min}
                  max={f.max}
                  step={f.type === "number" ? (f.step ?? 1) : undefined}
                  placeholder={f.placeholder}
                  readOnly={f.readOnly}
                  aria-invalid={!!errors[f.name]}
                  aria-describedby={
                    errors[f.name] ? "error-" + f.name : undefined
                  }
                  {...register(f.name)}
                />
              )}{" "}
              {errors[f.name] && (
                <span
                  id={"error-" + f.name}
                  className="field-error"
                  role="alert"
                >
                  {String(errors[f.name]?.message)}
                </span>
              )}
            </div>
          ))}
        </div>
        {children}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary wide" type="submit">
          {isSubmitting ? "Đang lưu..." : submit}
        </button>
      </fieldset>
    </form>
  );
}

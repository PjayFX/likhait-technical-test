/**
 * Custom hook for managing expense form state and validation
 */

import { useState } from "react";
import { ExpenseFormData } from "../types";
import { formatDate } from "../utils/expenseUtils";

interface UseExpenseFormProps {
  initialData?: Partial<ExpenseFormData>;
  onSubmit: (data: ExpenseFormData) => Promise<void>;
}

export function useExpenseForm({ initialData, onSubmit }: UseExpenseFormProps) {
  const [formData, setFormData] = useState<ExpenseFormData>({
    amount: initialData?.amount || "",
    description: initialData?.description || "",
    category: initialData?.category || "",
    date: initialData?.date || formatDate(new Date()),
  });

  const [errors, setErrors] = useState<Partial<ExpenseFormData>>({});
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (field: keyof ExpenseFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<ExpenseFormData> = {};

    if (!formData.amount || Number(formData.amount) <= 0) {
      newErrors.amount = "Amount must be greater than 0";
    }

    if (!formData.description.trim()) {
      newErrors.description = "Description is required";
    }

    if (!formData.category) {
      newErrors.category = "Category is required";
    }

    if (!formData.date) {
      newErrors.date = "Date is required";
    } else if (formData.date > formatDate(new Date())) {
      newErrors.date =
        "Date cannot be in the future. Please select today or an earlier date.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(undefined);
    try {
      await onSubmit(formData);
      // Reset form on success
      setFormData({
        amount: "",
        description: "",
        category: "",
        date: formatDate(new Date()),
      });
      setErrors({});
    } catch (error) {
      console.error("Form submission error:", error);
      setSubmitError(
        error instanceof Error ? error.message : "Failed to save expense",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      amount: initialData?.amount || "",
      description: initialData?.description || "",
      category: initialData?.category || "",
      date: initialData?.date || formatDate(new Date()),
    });
    setErrors({});
  };

  return {
    formData,
    errors,
    submitError,
    isSubmitting,
    handleChange,
    handleSubmit,
    resetForm,
  };
}

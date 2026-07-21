"use client";

import { PlanEditor, emptyPlan } from "../_components/PlanEditor";

export default function NewPlanPage() {
    return <PlanEditor initial={emptyPlan()} />;
}

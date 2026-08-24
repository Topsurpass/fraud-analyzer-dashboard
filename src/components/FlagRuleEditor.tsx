"use client";

/**
 * Writes the rules that decide which rows get flagged.
 *
 * The column choices come from the preview the editor has already fetched, so
 * an analyst picks a real column name instead of typing one and finding out it
 * was wrong after saving. Before a preview has run the field falls back to free
 * text, because a rule is legitimately written before the query has ever been
 * executed, and refusing to let someone type is worse than letting them.
 *
 * A rule ANDs its conditions; a row is flagged when any enabled rule matches.
 * The wording in the UI says exactly that, because "all"/"any" is the one thing
 * about this feature a user can get wrong without any error to tell them.
 */

import {
	BINARY_OPERATORS,
	FLAG_SEVERITIES,
	NULLARY_OPERATORS,
	OPERATOR_LABELS,
	type FlagCondition,
	type FlagOperator,
	type FlagRule,
	type FlagSeverity,
} from "@/contracts/api";
import { Button, Field, Input, Panel, Select } from "@/components/ui";

/** Offered in this order: the comparisons people reach for first come first. */
const OPERATORS = Object.keys(OPERATOR_LABELS) as FlagOperator[];

export function takesNoValue(operator: FlagOperator): boolean {
	return NULLARY_OPERATORS.includes(operator);
}

export function takesTwoValues(operator: FlagOperator): boolean {
	return BINARY_OPERATORS.includes(operator);
}

export function emptyCondition(column = ""): FlagCondition {
	return { column_name: column, operator: "gt", value: "" };
}

export function emptyRule(index: number, column = ""): FlagRule {
	return {
		name: `Rule ${index + 1}`,
		severity: "medium",
		enabled: true,
		conditions: [emptyCondition(column)],
	};
}

/**
 * Everything wrong with a rule set, as messages keyed by position.
 *
 * Deliberately mirrors what the engine's schema enforces, so the editor can say
 * so before a round trip rather than surfacing a 422 with no location. The
 * engine remains the authority; this is only the fast path.
 */
export function validateRules(rules: FlagRule[]): Map<string, string> {
	const problems = new Map<string, string>();
	const seen = new Map<string, number>();

	rules.forEach((rule, ruleIndex) => {
		const name = rule.name.trim();
		if (!name) {
			problems.set(`rule:${ruleIndex}`, "A rule needs a name.");
		} else {
			const key = name.toLowerCase();
			const first = seen.get(key);
			if (first !== undefined) {
				problems.set(`rule:${ruleIndex}`, `Another rule is already called "${name}".`);
			} else {
				seen.set(key, ruleIndex);
			}
		}

		if (rule.conditions.length === 0) {
			problems.set(`rule:${ruleIndex}`, "A rule needs at least one condition.");
		}

		rule.conditions.forEach((condition, conditionIndex) => {
			const key = `cond:${ruleIndex}:${conditionIndex}`;
			if (!condition.column_name.trim()) {
				problems.set(key, "Pick a column.");
				return;
			}
			if (takesNoValue(condition.operator)) return;
			if (!condition.value?.trim()) {
				problems.set(key, "This comparison needs a value.");
				return;
			}
			if (takesTwoValues(condition.operator) && !condition.value2?.trim()) {
				problems.set(key, "Between needs both bounds.");
			}
		});
	});

	return problems;
}

export interface FlagRuleEditorProps {
	rules: FlagRule[];
	onChange: (rules: FlagRule[]) => void;
	/** Result columns from the last preview. Empty before one has run. */
	columns: string[];
	/** Per-rule match counts from a preview, keyed by the rule's index. */
	matchCounts?: Map<number, number> | null;
	disabled?: boolean;
}

export function FlagRuleEditor({
	rules,
	onChange,
	columns,
	matchCounts,
	disabled = false,
}: FlagRuleEditorProps) {
	const problems = validateRules(rules);

	const patchRule = (index: number, patch: Partial<FlagRule>) => {
		onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
	};

	const patchCondition = (
		ruleIndex: number,
		conditionIndex: number,
		patch: Partial<FlagCondition>,
	) => {
		patchRule(ruleIndex, {
			conditions: rules[ruleIndex].conditions.map((condition, i) =>
				i === conditionIndex ? { ...condition, ...patch } : condition,
			),
		});
	};

	const changeOperator = (
		ruleIndex: number,
		conditionIndex: number,
		operator: FlagOperator,
	) => {
		// Clear values the new operator does not read, so a switch to "is empty"
		// and back cannot leave a stale bound behind that nothing displayed.
		const patch: Partial<FlagCondition> = { operator };
		if (takesNoValue(operator)) {
			patch.value = "";
			patch.value2 = "";
		} else if (!takesTwoValues(operator)) {
			patch.value2 = "";
		}
		patchCondition(ruleIndex, conditionIndex, patch);
	};

	return (
		<Panel
			title="Flag rules"
			actions={
				<Button
					type="button"
					disabled={disabled}
					onClick={() => onChange([...rules, emptyRule(rules.length, columns[0] ?? "")])}
				>
					Add rule
				</Button>
			}
		>
			<div className="space-y-3 p-3">
				<p className="text-[11px] leading-relaxed text-text-secondary">
					A row is flagged when <strong>any</strong> rule matches it. A rule matches
					when <strong>all</strong> of its conditions hold. Rules run over the rows the
					query returns, so they see at most the row limit.
				</p>

				{rules.length === 0 ? (
					<p className="border border-dashed border-line px-3 py-4 text-[11px] text-text-secondary">
						No rules yet. Without them the dashboard falls back to guessing, by
						looking for a boolean column with a name like <code>is_fraud</code> and
						otherwise testing the plotted values for outliers.
					</p>
				) : null}

				{rules.map((rule, ruleIndex) => {
					const ruleProblem = problems.get(`rule:${ruleIndex}`);
					const matched = matchCounts?.get(ruleIndex);
					return (
						<div key={ruleIndex} className="border border-line bg-surface">
							<div className="flex flex-wrap items-end gap-2 border-b border-line p-2">
								<div className="min-w-[10rem] flex-1">
									<Field label="Rule name" htmlFor={`rule-name-${ruleIndex}`} error={ruleProblem ?? null}>
										<Input
											id={`rule-name-${ruleIndex}`}
											value={rule.name}
											disabled={disabled}
											onChange={(event) => patchRule(ruleIndex, { name: event.target.value })}
											placeholder="Large transfer"
										/>
									</Field>
								</div>

								<Field label="Severity" htmlFor={`rule-severity-${ruleIndex}`}>
									<Select
										id={`rule-severity-${ruleIndex}`}
										value={rule.severity}
										disabled={disabled}
										onChange={(event) =>
											patchRule(ruleIndex, { severity: event.target.value as FlagSeverity })
										}
									>
										{FLAG_SEVERITIES.map((severity) => (
											<option key={severity} value={severity}>
												{severity}
											</option>
										))}
									</Select>
								</Field>

								<label className="flex items-center gap-1.5 pb-1.5 text-[11px] text-text-secondary">
									<input
										type="checkbox"
										checked={rule.enabled}
										disabled={disabled}
										onChange={(event) => patchRule(ruleIndex, { enabled: event.target.checked })}
									/>
									Enabled
								</label>

								{matched !== undefined ? (
									<span className="pb-1.5 text-[11px] tnum text-text-secondary">
										{matched} in preview
									</span>
								) : null}

								<Button
									type="button"
									disabled={disabled}
									onClick={() => onChange(rules.filter((_, i) => i !== ruleIndex))}
									aria-label={`Remove rule ${rule.name || ruleIndex + 1}`}
								>
									Remove
								</Button>
							</div>

							<div className="space-y-2 p-2">
								{rule.conditions.map((condition, conditionIndex) => {
									const problem = problems.get(`cond:${ruleIndex}:${conditionIndex}`);
									return (
										<div key={conditionIndex} className="space-y-1">
											<div className="flex flex-wrap items-center gap-2">
												{conditionIndex > 0 ? (
													<span className="text-[10px] uppercase tracking-wide text-text-secondary">
														and
													</span>
												) : null}

												{columns.length > 0 ? (
													<Select
														aria-label="Column"
														value={condition.column_name}
														disabled={disabled}
														onChange={(event) =>
															patchCondition(ruleIndex, conditionIndex, {
																column_name: event.target.value,
															})
														}
													>
														<option value="">Pick a column…</option>
														{/* A rule written before a SELECT change can name a
														    column the preview no longer returns. Keeping it
														    as an option means editing the rule does not
														    silently rewrite it to something else. */}
														{!condition.column_name || columns.includes(condition.column_name)
															? null
															: (
																<option value={condition.column_name}>
																	{condition.column_name} (not in result)
																</option>
															)}
														{columns.map((column) => (
															<option key={column} value={column}>
																{column}
															</option>
														))}
													</Select>
												) : (
													<Input
														aria-label="Column"
														value={condition.column_name}
														disabled={disabled}
														onChange={(event) =>
															patchCondition(ruleIndex, conditionIndex, {
																column_name: event.target.value,
															})
														}
														placeholder="column"
														className="w-40"
													/>
												)}

												<Select
													aria-label="Comparison"
													value={condition.operator}
													disabled={disabled}
													onChange={(event) =>
														changeOperator(
															ruleIndex,
															conditionIndex,
															event.target.value as FlagOperator,
														)
													}
												>
													{OPERATORS.map((operator) => (
														<option key={operator} value={operator}>
															{OPERATOR_LABELS[operator]}
														</option>
													))}
												</Select>

												{takesNoValue(condition.operator) ? null : (
													<Input
														aria-label="Value"
														value={condition.value ?? ""}
														disabled={disabled}
														onChange={(event) =>
															patchCondition(ruleIndex, conditionIndex, {
																value: event.target.value,
															})
														}
														placeholder={
															condition.operator === "in" || condition.operator === "not_in"
																? "NG, GH, KE"
																: "500"
														}
														className="w-32"
													/>
												)}

												{takesTwoValues(condition.operator) ? (
													<>
														<span className="text-[10px] uppercase tracking-wide text-text-secondary">
															and
														</span>
														<Input
															aria-label="Upper bound"
															value={condition.value2 ?? ""}
															disabled={disabled}
															onChange={(event) =>
																patchCondition(ruleIndex, conditionIndex, {
																	value2: event.target.value,
																})
															}
															placeholder="900"
															className="w-32"
														/>
													</>
												) : null}

												{rule.conditions.length > 1 ? (
													<Button
														type="button"
														disabled={disabled}
														onClick={() =>
															patchRule(ruleIndex, {
																conditions: rule.conditions.filter(
																	(_, i) => i !== conditionIndex,
																),
															})
														}
														aria-label={`Remove condition ${conditionIndex + 1}`}
													>
														−
													</Button>
												) : null}
											</div>

											{problem ? (
												<p className="text-[11px] text-change">{problem}</p>
											) : null}
										</div>
									);
								})}

								<Button
									type="button"
									disabled={disabled}
									onClick={() =>
										patchRule(ruleIndex, {
											conditions: [...rule.conditions, emptyCondition(columns[0] ?? "")],
										})
									}
								>
									Add condition
								</Button>
							</div>
						</div>
					);
				})}
			</div>
		</Panel>
	);
}

type MetricLabels = Record<
	string,
	string | number | boolean | null | undefined
>;

type CounterSample = {
	name: string;
	labels: Record<string, string>;
	value: number;
};

type HistogramSample = {
	name: string;
	labels: Record<string, string>;
	buckets: number[];
	counts: number[];
	sum: number;
	count: number;
};

const counters = new Map<string, CounterSample>();
const histograms = new Map<string, HistogramSample>();
const defaultBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000];

export function incrementCounter(
	name: string,
	labels: MetricLabels = {},
	value = 1,
) {
	const normalizedLabels = normalizeLabels(labels);
	const key = metricKey(name, normalizedLabels);
	const sample = counters.get(key) ?? {
		name,
		labels: normalizedLabels,
		value: 0,
	};
	sample.value += value;
	counters.set(key, sample);
}

export function observeHistogram(
	name: string,
	labels: MetricLabels,
	value: number,
	buckets = defaultBuckets,
) {
	const normalizedLabels = normalizeLabels(labels);
	const key = metricKey(name, normalizedLabels);
	const sample = histograms.get(key) ?? {
		name,
		labels: normalizedLabels,
		buckets,
		counts: buckets.map(() => 0),
		sum: 0,
		count: 0,
	};

	for (let i = 0; i < sample.buckets.length; i += 1) {
		const bucket = sample.buckets[i];
		const count = sample.counts[i] ?? 0;
		if (bucket !== undefined && value <= bucket) sample.counts[i] = count + 1;
	}
	sample.sum += value;
	sample.count += 1;
	histograms.set(key, sample);
}

export function renderMetrics() {
	const lines: string[] = [];

	for (const sample of counters.values()) {
		lines.push(`${sample.name}${formatLabels(sample.labels)} ${sample.value}`);
	}

	for (const sample of histograms.values()) {
		for (let i = 0; i < sample.buckets.length; i += 1) {
			lines.push(
				`${sample.name}_bucket${formatLabels({
					...sample.labels,
					le: String(sample.buckets[i]),
				})} ${sample.counts[i]}`,
			);
		}
		lines.push(
			`${sample.name}_bucket${formatLabels({ ...sample.labels, le: "+Inf" })} ${sample.count}`,
		);
		lines.push(
			`${sample.name}_sum${formatLabels(sample.labels)} ${sample.sum}`,
		);
		lines.push(
			`${sample.name}_count${formatLabels(sample.labels)} ${sample.count}`,
		);
	}

	return `${lines.join("\n")}\n`;
}

function normalizeLabels(labels: MetricLabels) {
	return Object.fromEntries(
		Object.entries(labels)
			.filter(([, value]) => value !== undefined && value !== null)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => [key, String(value)]),
	);
}

function metricKey(name: string, labels: Record<string, string>) {
	return `${name}:${JSON.stringify(labels)}`;
}

function formatLabels(labels: Record<string, string>) {
	const entries = Object.entries(labels);
	if (entries.length === 0) return "";
	return `{${entries
		.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
		.join(",")}}`;
}

function escapeLabelValue(value: string) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
		.replace(/"/g, '\\"');
}

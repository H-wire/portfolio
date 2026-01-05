import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRegimeAnalysis } from '../api';
import { RegimeAnalysisRequest, RegimeAnalysisResponse, ScorecardItem, ChartData } from '../types';
import Chart from 'chart.js/auto';
import { Line } from 'react-chartjs-2';

// Helper to format date for input fields
const formatDateForInput = (date: Date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface RegimeDashboardProps {
  orgId: number | null;
  disabled: boolean;
}

const RegimeDashboard: React.FC<RegimeDashboardProps> = ({ orgId, disabled }) => {
  const [indexTicker, setIndexTicker] = useState<string>('^GSPC');
  const [vixTicker, setVixTicker] = useState<string>('^VIX');
  const [startDate, setStartDate] = useState<string>(formatDateForInput(new Date(Date.now() - 730 * 24 * 60 * 60 * 1000))); // 2 years back
  const [maShort, setMaShort] = useState<number>(50);
  const [maLong, setMaLong] = useState<number>(200);
  const [rsiPeriod, setRsiPeriod] = useState<number>(14);
  const [rsiThreshold, setRsiThreshold] = useState<number>(50);
  const [vixThresholdBull, setVixThresholdBull] = useState<number>(20);
  const [vixThresholdBear, setVixThresholdBear] = useState<number>(25);
  const [componentTickers, setComponentTickers] = useState<string>('');
  const [includeBreadth, setIncludeBreadth] = useState<boolean>(false);

  const requestPayload: RegimeAnalysisRequest = {
    index_ticker: indexTicker,
    vix_ticker: vixTicker,
    start_date: startDate,
    ma_short: maShort,
    ma_long: maLong,
    rsi_period: rsiPeriod,
    rsi_threshold: rsiThreshold,
    vix_threshold_bull: vixThresholdBull,
    vix_threshold_bear: vixThresholdBear,
    component_tickers: includeBreadth && componentTickers ? componentTickers.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
  };

  const { data, isLoading, isError, error, refetch } = useQuery<RegimeAnalysisResponse, Error>({
    queryKey: ['regimeAnalysis', requestPayload],
    queryFn: () => fetchRegimeAnalysis(requestPayload),
    enabled: !disabled, // Only enable if not disabled
  });

  const handleAnalyze = () => {
    if (!disabled) {
      refetch(); // Manually trigger the query
    }
  };

  const getRegimeColor = (regime: string) => {
    switch (regime) {
      case 'Bull': return 'bg-green-500';
      case 'Neutral': return 'bg-yellow-500';
      case 'Bear': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Bull': return 'text-green-500';
      case 'Neutral': return 'text-yellow-500';
      case 'Bear': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const createChartData = (chartData: ChartData, label: string, datasetKey: keyof ChartData, borderColor: string, fill: boolean = false) => {
    return {
      labels: chartData.dates,
      datasets: [
        {
          label: label,
          data: chartData[datasetKey],
          borderColor: borderColor,
          backgroundColor: borderColor,
          fill: fill,
          tension: 0.1,
          pointRadius: 0,
        },
      ],
    };
  };

  const createPriceChartData = (chartData: ChartData) => {
    const datasets = [
      createChartData(chartData, 'Close', 'close', 'rgb(75, 192, 192)').datasets[0],
    ];
    if (chartData.ma50) {
      datasets.push(createChartData(chartData, `MA${maShort}`, 'ma50', 'rgb(255, 99, 132)').datasets[0]);
    }
    if (chartData.ma200) {
      datasets.push(createChartData(chartData, `MA${maLong}`, 'ma200', 'rgb(53, 162, 235)').datasets[0]);
    }
    return { labels: chartData.dates, datasets };
  };

  const createRSIChartData = (chartData: ChartData) => {
    const datasets = [
      createChartData(chartData, 'RSI', 'rsi', 'rgb(153, 102, 255)').datasets[0],
      {
        label: `RSI Threshold (${rsiThreshold})`,
        data: chartData.dates.map(() => rsiThreshold),
        borderColor: 'rgb(255, 205, 86)',
        borderDash: [5, 5],
        fill: false,
        tension: 0.1,
        pointRadius: 0,
      }
    ];
    return { labels: chartData.dates, datasets };
  };

  const createVIXChartData = (chartData: ChartData) => {
    const datasets = [
      createChartData(chartData, 'VIX Close', 'close', 'rgb(255, 159, 64)').datasets[0],
      {
        label: `VIX Bull Threshold (${vixThresholdBull})`,
        data: chartData.dates.map(() => vixThresholdBull),
        borderColor: 'rgb(0, 128, 0)',
        borderDash: [5, 5],
        fill: false,
        tension: 0.1,
        pointRadius: 0,
      },
      {
        label: `VIX Bear Threshold (${vixThresholdBear})`,
        data: chartData.dates.map(() => vixThresholdBear),
        borderColor: 'rgb(255, 0, 0)',
        borderDash: [5, 5],
        fill: false,
        tension: 0.1,
        pointRadius: 0,
      }
    ];
    return { labels: chartData.dates, datasets };
  };

  return (
    <div className="flex h-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <div className="w-1/4 p-4 bg-white dark:bg-gray-800 shadow-md overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Regime Analysis Settings</h2>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Index Ticker</label>
          <input
            type="text"
            className="w-full p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700"
            value={indexTicker}
            onChange={(e) => setIndexTicker(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">VIX Ticker</label>
          <input
            type="text"
            className="w-full p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700"
            value={vixTicker}
            onChange={(e) => setVixTicker(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Start Date</label>
          <input
            type="date"
            className="w-full p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">MA Short Window ({maShort})</label>
          <input
            type="range"
            min="10"
            max="100"
            value={maShort}
            onChange={(e) => setMaShort(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">MA Long Window ({maLong})</label>
          <input
            type="range"
            min="100"
            max="300"
            value={maLong}
            onChange={(e) => setMaLong(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">RSI Period ({rsiPeriod})</label>
          <input
            type="range"
            min="5"
            max="30"
            value={rsiPeriod}
            onChange={(e) => setRsiPeriod(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">RSI Threshold ({rsiThreshold})</label>
          <input
            type="range"
            min="30"
            max="70"
            value={rsiThreshold}
            onChange={(e) => setRsiThreshold(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">VIX Bull Threshold ({vixThresholdBull})</label>
          <input
            type="range"
            min="10"
            max="30"
            value={vixThresholdBull}
            onChange={(e) => setVixThresholdBull(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">VIX Bear Threshold ({vixThresholdBear})</label>
          <input
            type="range"
            min="20"
            max="40"
            value={vixThresholdBear}
            onChange={(e) => setVixThresholdBear(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
            disabled={disabled}
          />
        </div>
        <div className="mb-4">
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={includeBreadth}
              onChange={(e) => setIncludeBreadth(e.target.checked)}
              disabled={disabled}
            />
            <span className="ml-2 text-sm font-medium">Include Market Breadth</span>
          </label>
          {includeBreadth && (
            <textarea
              className="w-full p-2 mt-2 border border-gray-300 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700"
              rows={5}
              placeholder="Enter component tickers, one per line (e.g., AAPL, MSFT)"
              value={componentTickers}
              onChange={(e) => setComponentTickers(e.target.value)}
              disabled={disabled}
            ></textarea>
          )}
        </div>
        <button
          onClick={handleAnalyze}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition duration-300"
          disabled={isLoading || disabled}
        >
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        <h1 className="text-3xl font-bold mb-6">Market Regime Dashboard</h1>

        {isLoading && (
          <div className="text-center text-lg">Loading analysis...</div>
        )}

        {isError && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <strong className="font-bold">Error!</strong>
            <span className="block sm:inline"> {error?.message || 'Failed to fetch regime analysis.'}</span>
          </div>
        )}

        {data && (
          <div>
            {/* Regime Badge */}
            <div className={`p-4 rounded-lg text-white text-center text-2xl font-bold mb-6 ${getRegimeColor(data.regime)}`}>
              Current Market Regime: {data.regime} (Score: {data.total_score})
            </div>

            {/* Scorecard */}
            <h2 className="text-2xl font-bold mb-4">Scorecard</h2>
            <div className="overflow-x-auto mb-8">
              <table className="min-w-full bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <thead className="bg-gray-200 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Factor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Value
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {data.scorecard.map((item: ScorecardItem, index: number) => (
                    <tr key={index}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{item.factor}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">{item.value}</td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm ${getStatusColor(item.status)}`}>
                        {item.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Charts */}
            <h2 className="text-2xl font-bold mb-4">Charts</h2>
            <div className="grid grid-cols-1 md:grid-cols-1 gap-8">
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                <h3 className="text-xl font-semibold mb-2">{indexTicker} Price & Moving Averages</h3>
                <Line data={createPriceChartData(data.charts.price_history)} />
              </div>
              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                <h3 className="text-xl font-semibold mb-2">{indexTicker} RSI ({rsiPeriod})</h3>
                <Line data={createRSIChartData(data.charts.rsi_history)} />
              </div>
              {vixTicker && data.charts.vix_history && data.charts.vix_history.dates.length > 0 && (
                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                  <h3 className="text-xl font-semibold mb-2">{vixTicker} Volatility Index</h3>
                  <Line data={createVIXChartData(data.charts.vix_history)} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegimeDashboard;
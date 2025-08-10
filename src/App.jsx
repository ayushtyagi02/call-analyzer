import React, { useState, useEffect } from 'react';
import { Clock, Upload, FileSpreadsheet, Calculator, AlertCircle, Phone, PhoneCall, Timer, BarChart3 } from 'lucide-react';

const CallDataAnalyzer = () => {
  const [data, setData] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [xlsxLoaded, setXlsxLoaded] = useState(false);

  // Load SheetJS library
  useEffect(() => {
    const loadXLSX = () => {
      if (window.XLSX) {
        setXlsxLoaded(true);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => {
        setXlsxLoaded(true);
        console.log('XLSX library loaded successfully');
      };
      script.onerror = () => {
        setError('Failed to load Excel processing library');
      };
      document.head.appendChild(script);
    };

    loadXLSX();
  }, []);

  const parseTime = (timeStr) => {
    if (!timeStr) return null;
    
    let cleanTime = timeStr.toString().trim();
    
    // Handle Excel decimal time format (e.g., 0.0028472222222222223)
    if (!isNaN(parseFloat(cleanTime)) && !cleanTime.includes(':')) {
      const decimalTime = parseFloat(cleanTime);
      // Excel stores time as fraction of a day, so multiply by 86400 (seconds in a day)
      const seconds = Math.round(decimalTime * 86400);
      console.log(`Converted decimal time ${decimalTime} to ${seconds} seconds`);
      return seconds;
    }
    
    // Handle HH:MM:SS format
    if (cleanTime.includes(':')) {
      const parts = cleanTime.split(':');
      if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
      }
      if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
      }
    }
    
    console.log('Could not parse time:', timeStr);
    return null;
  };

  const parseDateTime = (callStartTime) => {
    if (!callStartTime) return null;
    
    try {
      // Handle various date/time formats
      let dateTime;
      if (typeof callStartTime === 'string') {
        dateTime = new Date(callStartTime);
      } else if (typeof callStartTime === 'number') {
        // Excel date serial number
        dateTime = new Date((callStartTime - 25569) * 86400 * 1000);
      } else {
        dateTime = new Date(callStartTime);
      }
      
      return isNaN(dateTime.getTime()) ? null : dateTime;
    } catch (e) {
      console.error('Date parsing error:', e, callStartTime);
      return null;
    }
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const analyzeCallData = (callData) => {
    console.log('Starting analysis with data:', callData);
    
    if (!callData || callData.length === 0) {
      console.log('No data to analyze');
      return null;
    }

    // Process and sort calls
    console.log(typeof(callData))
    const processedCalls = callData.map((call, index) => {
      const startTime = parseDateTime(call['Call Start Time']);
      const duration = parseTime(call['Call Length']);
      const direction = call['Call Direction']?.toString().toLowerCase();
      const result = call['Result']?.toString().toLowerCase();
      
      console.log(`Call ${index}:`, {
        original: call,
        startTime,
        duration,
        direction,
        result
      });
      
      return {
        ...call,
        startTime,
        duration,
        direction,
        result,
        index
      };
    });

    const validCalls = processedCalls.filter(call => 
      call.startTime && call.duration !== null && call.direction
    );

    console.log('Valid calls after filtering:', validCalls);

    if (validCalls.length === 0) {
      setError('No valid calls found. Please check your data format.');
      return null;
    }

    const sortedCalls = validCalls.sort((a, b) => a.startTime - b.startTime);

    // Find outbound calls
    const outboundCalls = sortedCalls.filter(call => call.direction === 'outbound');
    console.log('Outbound calls:', outboundCalls);

    if (outboundCalls.length === 0) {
      setError('No outbound calls found in the data.');
      return null;
    }

    const firstOutbound = outboundCalls[0];
    const lastOutbound = outboundCalls[outboundCalls.length - 1];
    
    // Calculate total time span
    const lastCallEndTime = new Date(lastOutbound.startTime.getTime() + lastOutbound.duration * 1000);
    const totalTimeSpan = (lastCallEndTime - firstOutbound.startTime) / 1000; // in seconds

    let totalIdleTime = 0;
    let idleBreakdown = [];

    // Process calls to find idle times
    for (let i = 0; i < outboundCalls.length - 1; i++) {
      const currentCall = outboundCalls[i];
      const nextCall = outboundCalls[i + 1];
      
      // Calculate end time of current call
      const currentCallEnd = new Date(currentCall.startTime.getTime() + currentCall.duration * 1000);
      
      // Calculate gap time
      let gapTime = (nextCall.startTime - currentCallEnd) / 1000; // in seconds

      // Find answered inbound calls in this gap
      let inboundDuration = 0;
      const gapCalls = sortedCalls.filter(call => 
        call.startTime > currentCallEnd && 
        call.startTime < nextCall.startTime &&
        call.direction === 'inbound' && 
        call.result === 'connected'
      );

      inboundDuration = gapCalls.reduce((sum, call) => sum + call.duration, 0);

      // Calculate actual idle time
      const actualIdleTime = gapTime - inboundDuration;

      // If idle time > 8 minutes (480 seconds), add to idle time
      if (actualIdleTime > 480) {
        totalIdleTime += actualIdleTime;
        idleBreakdown.push({
          from: currentCallEnd,
          to: nextCall.startTime,
          rawGap: gapTime,
          inboundDuration,
          idleTime: actualIdleTime,
          gapCalls
        });
      }
    }

    // Subtract 45 minutes (2700 seconds) break allowance
    const breakAllowance = 45 * 60;
    const excessIdleTime = Math.max(0, totalIdleTime - breakAllowance);

    // Calculate actual work time
    const actualWorkTime = totalTimeSpan - excessIdleTime;

    const result = {
      totalCalls: sortedCalls.length,
      outboundCalls: outboundCalls.length,
      inboundCalls: sortedCalls.filter(call => call.direction === 'inbound').length,
      firstCallTime: firstOutbound.startTime,
      lastCallTime: lastCallEndTime,
      totalTimeSpan,
      totalIdleTime,
      breakAllowance,
      excessIdleTime,
      actualWorkTime,
      idleBreakdown,
      sortedCalls
    };

    console.log('Analysis result:', result);
    return result;
  };

  const handleFileUpload = async (event) => {
    console.log('File upload started');
    const file = event.target.files[0];
    if (!file) return;

    if (!xlsxLoaded) {
      setError('Excel processing library not loaded yet. Please wait and try again.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('Processing file:', file.name);
      const arrayBuffer = await file.arrayBuffer();
      console.log('File read successfully, size:', arrayBuffer.byteLength);
      
      const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });

      console.log('Workbook loaded, sheets:', workbook.SheetNames);
      
      const sheetName = workbook.SheetNames[1];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = window.XLSX.utils.sheet_to_json(worksheet);

      console.log('Data parsed:', jsonData.length, 'rows');
      console.log('Sample data:', jsonData[0]);

      if (jsonData.length === 0) {
        setError('No data found in the Excel file');
        return;
      }
      console.log(jsonData)
      setData(jsonData);
      const analysisResult = analyzeCallData(jsonData);
      setAnalysis(analysisResult);
      
    } catch (err) {
      console.error('Error processing file:', err);
      setError('Error processing file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <div className="w-full max-w-none">
          {/* Header */}
          <div className="w-full bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 sm:p-8 mb-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
                  <Clock className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900">
                    Call Data Analyzer
                  </h1>
                  <p className="text-gray-600 text-sm sm:text-base mt-1">
                    Analyze work hours from call records
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* File Upload Section */}
          <div className="w-full bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 sm:p-8 mb-8">
            <div className="text-center">
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 sm:p-12 hover:border-blue-400 hover:bg-blue-50/50 transition-all duration-300">
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-4 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full">
                    <FileSpreadsheet className="h-12 w-12 sm:h-16 sm:w-16 text-blue-600" />
                  </div>
                  
                  <div className="space-y-2">
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <span className="text-lg sm:text-xl font-semibold text-gray-800 hover:text-blue-600 transition-colors">
                        Upload Excel File
                      </span>
                      <input
                        id="file-upload"
                        type="file"
                        className="hidden"
                        accept=".xlsx,.xls"
                        onChange={handleFileUpload}
                        disabled={!xlsxLoaded}
                      />
                    </label>
                    <p className="text-sm sm:text-base text-gray-500 max-w-md mx-auto">
                      {xlsxLoaded 
                        ? 'Select an Excel file containing your call records to analyze work hours and productivity metrics' 
                        : 'Loading Excel processing library...'
                      }
                    </p>
                  </div>

                  {!xlsxLoaded && (
                    <div className="flex items-center gap-2 text-blue-600">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                      <span className="text-sm">Loading...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 sm:p-6 mb-8">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-red-800 font-medium">Error</h3>
                  <p className="text-red-700 text-sm mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="w-full bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-8 sm:p-12 mb-8">
              <div className="text-center space-y-4">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600"></div>
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Processing File</h3>
                  <p className="text-gray-600">Analyzing your call data...</p>
                </div>
              </div>
            </div>
          )}

          {/* Analysis Results */}
          {analysis && (
            <div className="space-y-8">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-blue-100 text-sm font-medium">Total Calls</p>
                      <p className="text-3xl font-bold">{analysis.totalCalls}</p>
                    </div>
                    <BarChart3 className="h-8 w-8 text-blue-200" />
                  </div>
                </div>

                <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-emerald-100 text-sm font-medium">Outbound</p>
                      <p className="text-3xl font-bold">{analysis.outboundCalls}</p>
                    </div>
                    <PhoneCall className="h-8 w-8 text-emerald-200" />
                  </div>
                </div>

                <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-orange-100 text-sm font-medium">Inbound</p>
                      <p className="text-3xl font-bold">{analysis.inboundCalls}</p>
                    </div>
                    <Phone className="h-8 w-8 text-orange-200" />
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-purple-100 text-sm font-medium">Work Time</p>
                      <p className="text-2xl sm:text-3xl font-bold">{formatDuration(Math.round(analysis.actualWorkTime))}</p>
                    </div>
                    <Timer className="h-8 w-8 text-purple-200" />
                  </div>
                </div>
              </div>

              {/* Detailed Analysis */}
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 sm:p-8">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                  <Calculator className="h-6 w-6 text-blue-600" />
                  Work Time Calculation
                </h2>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="font-semibold text-gray-800 text-lg">Time Period</h3>
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-gray-600 font-medium">First Call:</span>
                        <span className="font-semibold text-gray-900">{analysis.firstCallTime.toLocaleString()}</span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-gray-600 font-medium">Last Call End:</span>
                        <span className="font-semibold text-gray-900">{analysis.lastCallTime.toLocaleString()}</span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-gray-600 font-medium">Total Time Span:</span>
                        <span className="font-semibold text-blue-600">{formatDuration(Math.round(analysis.totalTimeSpan))}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-semibold text-gray-800 text-lg">Time Deductions</h3>
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-gray-600 font-medium">Total Idle Time:</span>
                        <span className="font-semibold text-red-600">{formatDuration(Math.round(analysis.totalIdleTime))}</span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-gray-600 font-medium">Break Allowance:</span>
                        <span className="font-semibold text-green-600">-{formatDuration(analysis.breakAllowance)}</span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-gray-600 font-medium">Excess Idle Time:</span>
                        <span className="font-semibold text-red-600">{formatDuration(Math.round(analysis.excessIdleTime))}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-gray-200">
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                      <span className="text-lg sm:text-xl font-bold text-gray-900">Actual Work Time:</span>
                      <span className="text-2xl sm:text-3xl font-bold text-green-600">{formatDuration(Math.round(analysis.actualWorkTime))}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Idle Time Breakdown */}
              {analysis.idleBreakdown.length > 0 && (
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 sm:p-8">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">
                    Idle Time Breakdown ({'>'} 8 minutes)
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-50 rounded-lg">
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 rounded-l-lg">From</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">To</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Raw Gap</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Inbound Duration</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 rounded-r-lg">Idle Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {analysis.idleBreakdown.map((idle, index) => (
                          <tr key={index} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-sm text-gray-900">{idle.from.toLocaleTimeString()}</td>
                            <td className="px-4 py-3 text-sm text-gray-900">{idle.to.toLocaleTimeString()}</td>
                            <td className="px-4 py-3 text-sm text-gray-700">{formatDuration(Math.round(idle.rawGap))}</td>
                            <td className="px-4 py-3 text-sm text-gray-700">{formatDuration(Math.round(idle.inboundDuration))}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-red-600">{formatDuration(Math.round(idle.idleTime))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Call Log */}
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 sm:p-8">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">Call Log</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 rounded-lg">
                        <th className="px-3 py-3 text-left text-sm font-semibold text-gray-600 rounded-l-lg">Time</th>
                        <th className="px-3 py-3 text-left text-sm font-semibold text-gray-600">Direction</th>
                        <th className="px-3 py-3 text-left text-sm font-semibold text-gray-600">Number</th>
                        <th className="px-3 py-3 text-left text-sm font-semibold text-gray-600">Result</th>
                        <th className="px-3 py-3 text-left text-sm font-semibold text-gray-600 rounded-r-lg">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {analysis.sortedCalls.map((call, index) => (
                        <tr key={index} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-3 text-sm text-gray-900 font-medium">{call.startTime.toLocaleTimeString()}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                              call.direction === 'outbound' 
                                ? 'bg-blue-100 text-blue-800' 
                                : 'bg-green-100 text-green-800'
                            }`}>
                              {call.direction}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-700 font-mono">{call['To Number'] || call['From Number']}</td>
                          <td className="px-3 py-3 text-sm text-gray-700 capitalize">{call.result}</td>
                          <td className="px-3 py-3 text-sm text-gray-900 font-medium">{formatDuration(call.duration)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CallDataAnalyzer;
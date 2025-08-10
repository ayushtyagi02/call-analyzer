import React, { useState, useEffect } from 'react';
import { Clock, Upload, FileSpreadsheet, Calculator, AlertCircle, Phone, PhoneCall, Timer, BarChart3, Calendar, TrendingUp } from 'lucide-react';

const CallDataAnalyzer = () => {
  const [filesData, setFilesData] = useState([]);
  const [dailyAnalysis, setDailyAnalysis] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [xlsxLoaded, setXlsxLoaded] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);

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
    
    return null;
  };

  const parseDateTime = (callStartTime) => {
    if (!callStartTime) return null;
    
    try {
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
      return null;
    }
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const getDateString = (date) => {
    return date.toDateString();
  };

  const analyzeCallData = (callData, fileName) => {
    if (!callData || callData.length === 0) {
      return null;
    }

    const processedCalls = callData.map((call) => {
      const startTime = parseDateTime(call['Call Start Time']);
      const duration = parseTime(call['Call Length']);
      const direction = call['Call Direction']?.toString().toLowerCase();
      const result = call['Result']?.toString().toLowerCase();
      
      return {
        ...call,
        startTime,
        duration,
        direction,
        result
      };
    });

    const validCalls = processedCalls.filter(call => 
      call.startTime && call.duration !== null && call.direction
    );

    if (validCalls.length === 0) {
      return null;
    }

    const sortedCalls = validCalls.sort((a, b) => a.startTime - b.startTime);
    const outboundCalls = sortedCalls.filter(call => call.direction === 'outbound');

    if (outboundCalls.length === 0) {
      return null;
    }

    const firstOutbound = outboundCalls[0];
    const lastOutbound = outboundCalls[outboundCalls.length - 1];
    const lastCallEndTime = new Date(lastOutbound.startTime.getTime() + lastOutbound.duration * 1000);
    const totalTimeSpan = (lastCallEndTime - firstOutbound.startTime) / 1000;

    let totalIdleTime = 0;

    // Calculate idle time between outbound calls
    for (let i = 0; i < outboundCalls.length - 1; i++) {
      const currentCall = outboundCalls[i];
      const nextCall = outboundCalls[i + 1];
      
      const currentCallEnd = new Date(currentCall.startTime.getTime() + currentCall.duration * 1000);
      let gapTime = (nextCall.startTime - currentCallEnd) / 1000;

      // Find answered inbound calls in this gap
      const gapCalls = sortedCalls.filter(call => 
        call.startTime > currentCallEnd && 
        call.startTime < nextCall.startTime &&
        call.direction === 'inbound' && 
        call.result === 'connected'
      );

      const inboundDuration = gapCalls.reduce((sum, call) => sum + call.duration, 0);
      const actualIdleTime = gapTime - inboundDuration;

      // If idle time > 8 minutes (480 seconds), add to idle time
      if (actualIdleTime > 480) {
        totalIdleTime += actualIdleTime;
      }
    }

    const breakAllowance = 45 * 60; // 45 minutes
    const excessIdleTime = Math.max(0, totalIdleTime - breakAllowance);
    const actualWorkTime = totalTimeSpan - excessIdleTime;

    return {
      fileName,
      date: getDateString(firstOutbound.startTime),
      dateObj: firstOutbound.startTime,
      totalCalls: sortedCalls.length,
      outboundCalls: outboundCalls.length,
      inboundCalls: sortedCalls.filter(call => call.direction === 'inbound').length,
      connectedCalls: sortedCalls.filter(call => call.result === 'connected').length,
      firstCallTime: firstOutbound.startTime,
      lastCallTime: lastCallEndTime,
      totalTimeSpan,
      totalIdleTime,
      breakAllowance,
      excessIdleTime,
      actualWorkTime,
      workHours: actualWorkTime / 3600,
      breakHours: Math.min(totalIdleTime, breakAllowance) / 3600,
      excessBreakHours: excessIdleTime / 3600
    };
  };

  const handleMultipleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    if (files.length > 10) {
      setError('Please select maximum 10 files at a time.');
      return;
    }

    if (!xlsxLoaded) {
      setError('Excel processing library not loaded yet. Please wait and try again.');
      return;
    }

    setLoading(true);
    setError('');
    setUploadedFiles([]);
    setFilesData([]);
    setDailyAnalysis([]);

    try {
      const allAnalysisResults = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Processing file ${i + 1}/${files.length}:`, file.name);

        const arrayBuffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[1] || workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = window.XLSX.utils.sheet_to_json(worksheet);

        if (jsonData.length === 0) {
          console.warn(`No data found in file: ${file.name}`);
          continue;
        }

        const analysisResult = analyzeCallData(jsonData, file.name);
        if (analysisResult) {
          allAnalysisResults.push(analysisResult);
          setUploadedFiles(prev => [...prev, file.name]);
        }
      }

      if (allAnalysisResults.length === 0) {
        setError('No valid data found in any of the uploaded files.');
        return;
      }

      // Sort by date
      allAnalysisResults.sort((a, b) => a.dateObj - b.dateObj);
      
      setFilesData(allAnalysisResults);
      setDailyAnalysis(allAnalysisResults);

    } catch (err) {
      console.error('Error processing files:', err);
      setError('Error processing files: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Calculate totals
  const totals = dailyAnalysis.length > 0 ? {
    totalFiles: dailyAnalysis.length,
    totalCalls: dailyAnalysis.reduce((sum, day) => sum + day.totalCalls, 0),
    totalOutbound: dailyAnalysis.reduce((sum, day) => sum + day.outboundCalls, 0),
    totalInbound: dailyAnalysis.reduce((sum, day) => sum + day.inboundCalls, 0),
    totalWorkHours: dailyAnalysis.reduce((sum, day) => sum + day.workHours, 0),
    totalBreakHours: dailyAnalysis.reduce((sum, day) => sum + day.breakHours, 0),
    totalExcessBreak: dailyAnalysis.reduce((sum, day) => sum + day.excessBreakHours, 0),
  } : null;

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
                    Multi-File Call Data Analyzer
                  </h1>
                  <p className="text-gray-600 text-sm sm:text-base mt-1">
                    Analyze work hours from multiple call records (up to 10 files)
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
                        Upload Multiple Excel Files
                      </span>
                      <input
                        id="file-upload"
                        type="file"
                        className="hidden"
                        accept=".xlsx,.xls"
                        multiple
                        onChange={handleMultipleFileUpload}
                        disabled={!xlsxLoaded}
                      />
                    </label>
                    <p className="text-sm sm:text-base text-gray-500 max-w-md mx-auto">
                      {xlsxLoaded 
                        ? 'Select up to 10 Excel files containing call records. Each file will be analyzed separately and shown date-wise.' 
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

                  {uploadedFiles.length > 0 && (
                    <div className="mt-4 text-sm text-gray-600">
                      <p className="font-medium">Uploaded Files ({uploadedFiles.length}):</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {uploadedFiles.map((fileName, index) => (
                          <span key={index} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                            {fileName}
                          </span>
                        ))}
                      </div>
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
                  <h3 className="text-lg font-medium text-gray-900">Processing Files</h3>
                  <p className="text-gray-600">Analyzing your call data files...</p>
                </div>
              </div>
            </div>
          )}

          {/* Summary Cards */}
          {totals && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-sm font-medium">Total Files</p>
                    <p className="text-3xl font-bold">{totals.totalFiles}</p>
                  </div>
                  <FileSpreadsheet className="h-8 w-8 text-blue-200" />
                </div>
              </div>

              <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-emerald-100 text-sm font-medium">Total Calls</p>
                    <p className="text-3xl font-bold">{totals.totalCalls}</p>
                  </div>
                  <BarChart3 className="h-8 w-8 text-emerald-200" />
                </div>
              </div>

              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-purple-100 text-sm font-medium">Total Work Hours</p>
                    <p className="text-3xl font-bold">{totals.totalWorkHours.toFixed(1)}h</p>
                  </div>
                  <Timer className="h-8 w-8 text-purple-200" />
                </div>
              </div>

              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-orange-100 text-sm font-medium">Avg Work/Day</p>
                    <p className="text-3xl font-bold">{(totals.totalWorkHours / totals.totalFiles).toFixed(1)}h</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-orange-200" />
                </div>
              </div>
            </div>
          )}

          {/* Daily Analysis Results */}
          {dailyAnalysis.length > 0 && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 sm:p-8">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <Calendar className="h-6 w-6 text-blue-600" />
                Daily Work Summary
              </h2>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 rounded-lg">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 rounded-l-lg">Date</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">File Name</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Total Calls</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Outbound</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Connected</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Work Hours</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Break Hours</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600 rounded-r-lg">Excess Break</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {dailyAnalysis.map((day, index) => (
                      <tr key={index} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900">{day.date}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 font-mono text-xs">{day.fileName}</td>
                        <td className="px-4 py-3 text-sm text-center font-semibold text-blue-600">{day.totalCalls}</td>
                        <td className="px-4 py-3 text-sm text-center text-gray-700">{day.outboundCalls}</td>
                        <td className="px-4 py-3 text-sm text-center text-green-600 font-semibold">{day.connectedCalls}</td>
                        <td className="px-4 py-3 text-sm text-center font-bold text-green-600">{day.workHours.toFixed(1)}h</td>
                        <td className="px-4 py-3 text-sm text-center text-blue-600">{day.breakHours.toFixed(1)}h</td>
                        <td className="px-4 py-3 text-sm text-center font-semibold text-red-600">
                          {day.excessBreakHours > 0 ? `${day.excessBreakHours.toFixed(1)}h` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                      <td className="px-4 py-3 text-sm font-bold text-gray-900" colSpan="2">TOTALS</td>
                      <td className="px-4 py-3 text-sm text-center font-bold text-blue-600">{totals.totalCalls}</td>
                      <td className="px-4 py-3 text-sm text-center font-bold text-gray-700">{totals.totalOutbound}</td>
                      <td className="px-4 py-3 text-sm text-center font-bold text-green-600">
                        {dailyAnalysis.reduce((sum, day) => sum + day.connectedCalls, 0)}
                      </td>
                      <td className="px-4 py-3 text-sm text-center font-bold text-green-600">{totals.totalWorkHours.toFixed(1)}h</td>
                      <td className="px-4 py-3 text-sm text-center font-bold text-blue-600">{totals.totalBreakHours.toFixed(1)}h</td>
                      <td className="px-4 py-3 text-sm text-center font-bold text-red-600">{totals.totalExcessBreak.toFixed(1)}h</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CallDataAnalyzer;
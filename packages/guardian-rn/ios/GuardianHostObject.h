#pragma once

#include <jsi/jsi.h>
#include <memory>
#include <atomic>
#include <mutex>
#include <functional>
#include <string>
#include <unordered_map>

namespace guardian {

using namespace facebook::jsi;

/**
 * JSI HostObject for guardian-rn.
 * Exposes three methods to JS (ADR-0003, ADR-0004):
 *   getSessionKey()               → ArrayBuffer (32 bytes, one-call-only)
 *   subscribe(filter, fn)         → subscriberId (string)
 *   unsubscribe(subscriberId)     → undefined
 *
 * Installed via installJSIBindings() on the JS thread.
 * Thread-safe: subscribe/unsubscribe may be called from any thread;
 * callbacks are dispatched via CallInvoker to the JS thread.
 */
class GuardianHostObject : public HostObject {
public:
    using EventCallback = std::function<void(const std::string& envelopeJson)>;

    explicit GuardianHostObject(
        std::vector<uint8_t> sessionKey,
        std::shared_ptr<facebook::react::CallInvoker> callInvoker
    );

    // HostObject interface
    Value get(Runtime& rt, const PropNameID& name) override;
    void set(Runtime& rt, const PropNameID& name, const Value& value) override;
    std::vector<PropNameID> getPropertyNames(Runtime& rt) override;

    // Called from native ThreatBus when a signed envelope is ready
    void emitEnvelope(const std::string& envelopeJson);

private:
    std::vector<uint8_t> sessionKey_;
    std::atomic<bool> keyDelivered_{false};

    std::shared_ptr<facebook::react::CallInvoker> callInvoker_;

    std::mutex subscriberMutex_;
    std::unordered_map<std::string, EventCallback> subscribers_;

    Value getSessionKeyImpl(Runtime& rt);
    Value subscribeImpl(Runtime& rt, const Value* args, size_t count);
    Value unsubscribeImpl(Runtime& rt, const Value* args, size_t count);

    static std::string generateSubscriberId();
};

} // namespace guardian
